import 'dotenv/config';
import { ethers } from 'ethers';
import type { JsonRpcProvider } from 'ethers';
import { createFhevmInstance } from '@fhevm-sdk'; 

const abi = [
  // views
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (bytes32)',
  'function balanceOf(address) view returns (bytes32)',
  'function allowance(address owner_, address spender) view returns (bytes32)',

  // grant-then-return helpers (state-changing)
  'function totalSupplyForCaller() returns (bytes32)',
  'function selfBalanceForCaller() returns (bytes32)',
  'function balanceOfForCaller(address) returns (bytes32)',

  // mint/burn
  'function mint(address to, uint64 rawAmount)',
  'function burn(uint64 rawAmount)',
] as const;

const MAX_UINT64 = (1n << 64n) - 1n;
const toRawAmount = (human: string, decimals: number) => {
  const raw = ethers.parseUnits(human, decimals);
  if (raw < 0n || raw > MAX_UINT64) throw new Error(`Amount won't fit uint64: ${raw}`);
  return raw;
};


async function initFhevm({
  provider,
  wallet,
}: {
  provider: JsonRpcProvider;
  wallet: ethers.Wallet;
}) {

  // EIP-1193 shim for ethers v6 JsonRpcProvider
  const eip1193 = {
    request: async ({ method, params }: { method: string; params?: any[] }) => {
      return provider.send(method, params ?? []);
    },
  };

  // create an AbortSignal (SDK expects it)
  const controller = new AbortController();

  const instance = await createFhevmInstance({
    provider: eip1193,
    signal: controller.signal,
    mockChains: undefined,
  });

//   // bind a signer 
//   if ("setSigner" in instance && typeof (instance as any).setSigner === "function") {
//     (instance as any).setSigner({
//       getAddress: async () => wallet.address,
//       signMessage: (msg: string | Uint8Array) => wallet.signMessage(msg as any),
//     });
//   }

  return instance;
}

/** Decrypt an euint64 ciphertext (bytes32 hex) into a bigint using the SDK. */
async function decryptEuint64(
  fhe: any,
  ciphertextBytes32: string,
  // reader can be either the user's address string or an ethers signer (wallet/signer)
  reader: string | { getAddress: () => Promise<string>; signTypedData?: any; _signTypedData?: any; signMessage?: any },
  contractAddress: `0x${string}`
): Promise<bigint> {
  if (!ciphertextBytes32) throw new Error('missing ciphertext');

  // Newer SDK exposes userDecrypt which supports batch decryption with a signature
  if (typeof fhe.userDecrypt === 'function') {
    const signer = typeof reader === 'string' ? undefined : reader;
    if (!signer) throw new Error('decryptEuint64: reader must be a signer when using userDecrypt');

    // generate ephemeral keypair
    const kp = (fhe as any).generateKeypair();
    const publicKey = kp.publicKey;
    const privateKey = kp.privateKey;

    const startTimestamp = Math.floor(Date.now() / 1000);
    const durationDays = 365;

    // build eip712 and sign it with the provided signer
    const eip712 = (fhe as any).createEIP712(publicKey, [contractAddress], startTimestamp, durationDays);

    let signature: string;
    try {
      if (typeof signer.signTypedData === 'function') {
        signature = await (signer as any).signTypedData(
          eip712.domain,
          { UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification },
          eip712.message
        );
      } else if (typeof signer._signTypedData === 'function') {
        signature = await (signer as any)._signTypedData(
          eip712.domain,
          { UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification },
          eip712.message
        );
      } else {
        throw new Error('Signer does not support typed-data signing (signTypedData/_signTypedData)');
      }
    } catch (e) {
      throw new Error(`Failed to create decryption signature: ${(e as any)?.message ?? e}`);
    }

    // call userDecrypt
    const req = [{ handle: ciphertextBytes32, contractAddress }];

    // retry loop for transient relayer parse/order errors
    let lastErr: any = null;
    let res: any;
    for (let attempt = 1; attempt <= 3; ++attempt) {
      try {
        res = await fhe.userDecrypt(
          req,
          privateKey,
          publicKey,
          signature,
          [contractAddress],
          await signer.getAddress(),
          startTimestamp,
          durationDays
        );
        lastErr = null;
        break;
      } catch (e: any) {
        lastErr = e;
        const msg = (e && (e.message || e.shortMessage || e?.error?.message) || '').toString();
        const isParseOrder = msg.includes('Parse event') || msg.includes('backward order');
        if (!isParseOrder) break; // not a transient parse-order error -> rethrow below
        // small backoff
        await new Promise((r) => setTimeout(r, 150 * attempt));
      }
    }
    if (lastErr) throw lastErr;

    // res may be an array or an object mapping
    if (Array.isArray(res) && res.length > 0) return BigInt(res[0]);
    if (res && typeof res === 'object') {
      // prefer direct handle lookup
      if (ciphertextBytes32 in res) return BigInt((res as any)[ciphertextBytes32] as any);
      // otherwise take first value
      const vals = Object.values(res);
      if (vals.length > 0) return BigInt(vals[0] as any);
    }

    throw new Error('userDecrypt returned unexpected result');
  }

  throw new Error(
    'fhEVM SDK decrypt function not found. Update @fhevm-sdk or adapt this helper to your version.'
  );
}

async function main() {
  // ---- CONFIG (fhEVM RPC!) ----
  const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8545';
  const PRIVATE_KEY =
    process.env.PRIVATE_KEY ??
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const TOKEN_ADDRESS = (process.env.TOKEN_ADDRESS ??
    '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512') as `0x${string}`;

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const token = new ethers.Contract(TOKEN_ADDRESS, abi, wallet);

  // ---- local nonce manager (from pending) ----
  let nextNonce = await provider.getTransactionCount(wallet.address, 'pending');
  const send = async (fn: (...a: any[]) => Promise<any>, args: any[] = []) => {
    // ensure `this` binding for contract methods
    const boundFn = (fn as any).bind ? (fn as any).bind(token) : fn;

    const fee = await provider.getFeeData();
    const opts = {
      nonce: nextNonce,
      maxFeePerGas: fee.maxFeePerGas ?? undefined,
      maxPriorityFeePerGas: fee.maxPriorityFeePerGas ?? undefined,
    };
    try {
      const tx = await boundFn(...args, opts);
      const rcpt = await tx.wait();
      nextNonce++;
      return rcpt;
    } catch (e: any) {
      const msg = e?.info?.error?.message || e?.shortMessage || e?.message || '';
      const isNonceErr =
        msg.includes('Nonce too low') ||
        msg.includes('nonce has already been used') ||
        msg.includes('Nonce too high');
      if (!isNonceErr) throw e;
      nextNonce = await provider.getTransactionCount(wallet.address, 'pending');
      const fee2 = await provider.getFeeData();
      const opts2 = {
        nonce: nextNonce,
        maxFeePerGas: fee2.maxFeePerGas ?? undefined,
        maxPriorityFeePerGas: fee2.maxPriorityFeePerGas ?? undefined,
      };
      const tx2 = await boundFn(...args, opts2);
      const rcpt2 = await tx2.wait();
      nextNonce++;
      return rcpt2;
    }
  };

  // ---- metadata ----
  const [name, symbol, decimals] = await Promise.all([
    token.name(),
    token.symbol(),
    token.decimals(),
  ]);
  console.log(`Token: ${name} (${symbol}), decimals=${decimals}`);
  console.log(`Caller: ${wallet.address}`);

  // ---- fhEVM SDK init ----
  const fhe = await initFhevm({ provider, wallet });

  // ---- grant read (ignore if not present) ----
  try {
    await send(token.totalSupplyForCaller, []);
  } catch {}
  try {
    await send(token.selfBalanceForCaller, []);
  } catch {}

  // ---- read & decrypt BEFORE mint ----
  const [tsBeforeCT, myBalBeforeCT] = await Promise.all([
    token.totalSupply(),
    token.balanceOf(wallet.address),
  ]);
  const [tsBefore, myBalBefore] = await Promise.all([
    decryptEuint64(fhe, tsBeforeCT, wallet, TOKEN_ADDRESS),
    decryptEuint64(fhe, myBalBeforeCT, wallet, TOKEN_ADDRESS),
  ]);
  console.log(`totalSupply (cipher): ${tsBeforeCT}`);
  console.log(`totalSupply (plain):  ${ethers.formatUnits(tsBefore, decimals)}`);
  console.log(`my balance (cipher):  ${myBalBeforeCT}`);
  console.log(`my balance (plain):   ${ethers.formatUnits(myBalBefore, decimals)}`);

  // ---- mint 2000 tokens to self ----
  const rawAmount = toRawAmount('2000', Number(decimals));
  console.log(`Minting raw=${rawAmount} to ${wallet.address} ...`);
  await send(token.mint, [wallet.address, rawAmount]);
  console.log('Minted.');

  // re-grant for fresh ciphertexts
  try {
    await send(token.totalSupplyForCaller, []);
  } catch {}
  try {
    await send(token.selfBalanceForCaller, []);
  } catch {}

  // ---- read & decrypt AFTER mint ----
  const [tsAfterCT, myBalAfterCT] = await Promise.all([
    token.totalSupply(),
    token.balanceOf(wallet.address),
  ]);
  const [tsAfter, myBalAfter] = await Promise.all([
    decryptEuint64(fhe, tsAfterCT, wallet, TOKEN_ADDRESS),
    decryptEuint64(fhe, myBalAfterCT, wallet, TOKEN_ADDRESS),
  ]);
  console.log(`totalSupply (after, cipher): ${tsAfterCT}`);
  console.log(`totalSupply (after, plain):  ${ethers.formatUnits(tsAfter, decimals)}`);
  console.log(`my balance  (after, cipher): ${myBalAfterCT}`);
  console.log(`my balance  (after, plain):  ${ethers.formatUnits(myBalAfter, decimals)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
