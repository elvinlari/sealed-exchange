import 'dotenv/config';
import { ethers } from 'ethers';
import type { JsonRpcProvider } from 'ethers';
import { createFhevmInstance } from '@fhevm-sdk';

async function initFhevm(provider: JsonRpcProvider, _wallet: ethers.Wallet) {
  // EIP-1193 shim for ethers v6 provider
  const eip1193 = {
    request: async ({ method, params }: { method: string; params?: any[] }) =>
      provider.send(method, params ?? []),
  };
  const controller = new AbortController();
  const inst: any = await createFhevmInstance({ provider: eip1193 as any, signal: controller.signal, mockChains: undefined });
  return inst as any;
}

// Decrypt an euint64 ciphertext (bytes32) to bigint using the same pattern as scripts/inspect.ts
async function decryptEuint64(
  fhe: any,
  ciphertextBytes32: string,
  signer: ethers.Wallet,
  contractAddress: `0x${string}`
): Promise<bigint> {
  if (!ciphertextBytes32 || ciphertextBytes32 === '0x') throw new Error('missing ciphertext');

  if (typeof fhe.userDecrypt !== 'function') {
    throw new Error('fhEVM SDK userDecrypt not found. Please update @fhevm-sdk.');
  }

  // Generate ephemeral keypair
  const kp = (fhe as any).generateKeypair();
  const publicKey = kp.publicKey;
  const privateKey = kp.privateKey;

  const startTimestamp = Math.floor(Date.now() / 1000);
  const durationDays = 365;

  // Build EIP-712 and sign with the provided signer
  const eip712 = (fhe as any).createEIP712(publicKey, [contractAddress], startTimestamp, durationDays);

  let signature: string;
  if (typeof (signer as any).signTypedData === 'function') {
    signature = await (signer as any).signTypedData(
      eip712.domain,
      { UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification },
      eip712.message
    );
  } else if (typeof (signer as any)._signTypedData === 'function') {
    signature = await (signer as any)._signTypedData(
      eip712.domain,
      { UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification },
      eip712.message
    );
  } else {
    throw new Error('Signer does not support typed-data signing');
  }

  const req = [{ handle: ciphertextBytes32, contractAddress }];

  // Retry loop for transient relayer ordering errors
  let lastErr: any = null;
  let res: any;
  for (let attempt = 1; attempt <= 3; ++attempt) {
    try {
      res = await (fhe as any).userDecrypt(
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
      if (!isParseOrder) break; // not a transient parse-order error
      await new Promise((r) => setTimeout(r, 150 * attempt));
    }
  }
  if (lastErr) throw lastErr;

  if (Array.isArray(res) && res.length > 0) return BigInt(res[0]);
  if (res && typeof res === 'object') {
    if (ciphertextBytes32 in res) return BigInt((res as any)[ciphertextBytes32] as any);
    const vals = Object.values(res);
    if (vals.length > 0) return BigInt(vals[0] as any);
  }
  throw new Error('userDecrypt returned unexpected result');
}

async function main() {
  const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8545';
  const PRIVATE_KEY =
    process.env.PRIVATE_KEY ??
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

  const VAULT_ADDRESS = (process.env.VAULT_ADDRESS ??
    '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9') as `0x${string}`;
  const ONE_ASSET_ID = process.env.ASSET_ID as `0x${string}` | undefined;

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider); // signer only for decrypt relayer
  const fhe: any = await initFhevm(provider, wallet);

  // Read-only ABI and contract (we'll use staticCall for state-changing helpers)
  const vaultAbi = [
    // state-changing helper — we'll call via .staticCall to fetch return values
    'function selfGetBalancesForCaller(bytes32 assetId) returns (bytes32 eAvailable, bytes32 eReservedAgg)',
    // listing helpers
    'function listAssets(uint256 offset, uint256 limit) view returns (bytes32[] ids, address[] tokens, bool[] enabled, bool[] paused, bool[] isNumeraire)',
    'function getAsset(bytes32) view returns (address token, bool enabled, bool paused, bool isNumeraire)',
  ];
  const erc20Abi = ['function name() view returns (string)', 'function decimals() view returns (uint8)'];

  const vaultRead = new ethers.Contract(VAULT_ADDRESS, vaultAbi, provider);

  // decrypt helper using inspect.ts pattern
  async function decrypt64(cipherBytes: string): Promise<bigint> {
    // ensure 0x-prefixed bytes32
    const asHex = ethers.hexlify(cipherBytes) as `0x${string}`;
    return decryptEuint64(fhe, asHex, wallet, VAULT_ADDRESS);
  }

  // get assets (provider-only calls)
  const assets: Array<{ id: `0x${string}`; token: `0x${string}`; enabled: boolean; paused: boolean }> = [];

  if (ONE_ASSET_ID) {
    const res = await vaultRead.getAsset(ONE_ASSET_ID);
    const token = res[0] as `0x${string}`;
    const enabled = res[1] as boolean;
    const paused = res[2] as boolean;
    assets.push({ id: ONE_ASSET_ID, token, enabled, paused });
  } else {
    let offset = 0;
    const pageSize = 50;
    while (true) {
      const res = await vaultRead.listAssets(offset, pageSize);
      const ids = res[0] as `0x${string}`[];
      const tokens = res[1] as `0x${string}`[];
      const enabledFlags = res[2] as boolean[];
      const pausedFlags = res[3] as boolean[];
      if (!ids.length) break;
      for (let i = 0; i < ids.length; i++) {
        assets.push({ id: ids[i], token: tokens[i], enabled: enabledFlags[i], paused: pausedFlags[i] });
      }
      offset += ids.length;
    }
  }

  console.log(`\nFetching balances for: ${wallet.address}`);
  console.log(`Vault: ${VAULT_ADDRESS}`);
  console.log(`Assets found: ${assets.length}\n`);

  for (const a of assets) {
    try {
      // IMPORTANT:
      // selfGetBalancesForCaller is NOT view in your contract (it calls FHE.allow),
      // so we must call it via staticCall to get its return values without sending a tx.
  const [eAvail, eRes] = await vaultRead.selfGetBalancesForCaller.staticCall(
    a.id,
    { from: wallet.address }
  );

  // Short-circuit zeros
  const zeroish = (v: string) => !v || v === '0x' || /^0x0+$/.test(v);

  let rawAvail = 0n;
  let rawRes = 0n;
  if (!zeroish(eAvail)) rawAvail = await decrypt64(eAvail);
  if (!zeroish(eRes)) rawRes = await decrypt64(eRes);

      const token = new ethers.Contract(a.token, erc20Abi, provider);
      const [tName, tDecimals] = await Promise.all([token.name(), token.decimals()]);
      const humanAvail = ethers.formatUnits(rawAvail, tDecimals);
      const humanRes = ethers.formatUnits(rawRes, tDecimals);

      console.log(`Asset: ${a.id}`);
      console.log(`  Token: ${a.token} (${tName})  enabled=${a.enabled} paused=${a.paused}`);
      console.log(`  Available: ${humanAvail} (raw=${rawAvail})`);
      console.log(`  Reserved : ${humanRes} (raw=${rawRes})\n`);
    } catch (err: any) {
      console.error(`Asset ${a.id} — failed to fetch/decrypt balances: ${err?.message ?? err}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
