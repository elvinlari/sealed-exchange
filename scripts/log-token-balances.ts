import 'dotenv/config';
import { ethers } from 'ethers';
import type { JsonRpcProvider } from 'ethers';
import fs from 'node:fs';
import path from 'node:path';
import { createFhevmInstance } from '@fhevm-sdk';

// Minimal types for local JSON files
interface AccountEntry {
  index: number;
  address: `0x${string}`;
  privateKey: `0x${string}`;
  tokens?: Record<string, number | string>;
}
interface AddressesJson { accounts: AccountEntry[] }
interface ContractsJson {
  VAULT_ADDRESS: `0x${string}`;
  TOKEN_CUSDT_ADDRESS: `0x${string}`;
  TOKEN_CBTC_ADDRESS: `0x${string}`;
  MARKET_CBTC_CUSDT_ADDRESS?: `0x${string}`;
}

// Initialize FHEVM SDK instance once per provider
async function initFhevm(provider: JsonRpcProvider) {
  const eip1193 = {
    request: async ({ method, params }: { method: string; params?: any[] }) =>
      provider.send(method, params ?? []),
  };
  const controller = new AbortController();
  const inst: any = await createFhevmInstance({ provider: eip1193 as any, signal: controller.signal, mockChains: undefined });
  return inst as any;
}

// Decrypt an euint64 ciphertext (bytes32) using a specific signer and contract scope
async function decryptEuint64(
  fhe: any,
  ciphertextBytes32: string,
  signer: ethers.Wallet,
  contractAddress: `0x${string}`
): Promise<bigint> {
  if (!ciphertextBytes32 || ciphertextBytes32 === '0x') throw new Error('missing ciphertext');

  if (typeof (fhe as any).userDecrypt !== 'function') {
    throw new Error('fhEVM SDK userDecrypt not found. Please update @fhevm-sdk.');
  }

  // Ephemeral keypair for this decrypt session
  const kp = (fhe as any).generateKeypair();
  const publicKey = kp.publicKey;
  const privateKey = kp.privateKey;

  const startTimestamp = Math.floor(Date.now() / 1000);
  const durationDays = 365; // long-lived session for local dev

  // EIP-712 payload over this contract
  const eip712 = (fhe as any).createEIP712(publicKey, [contractAddress], startTimestamp, durationDays);

  let signature: string;
  const signerAny: any = signer as any;
  if (typeof signerAny.signTypedData === 'function') {
    signature = await signerAny.signTypedData(
      eip712.domain,
      { UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification },
      eip712.message
    );
  } else if (typeof signerAny._signTypedData === 'function') {
    signature = await signerAny._signTypedData(
      eip712.domain,
      { UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification },
      eip712.message
    );
  } else {
    throw new Error('Signer does not support typed-data signing');
  }

  const req = [{ handle: ciphertextBytes32, contractAddress }];

  // Retry a few times to absorb relayer event ordering quirks
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
      if (!isParseOrder) break;
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
  const ROOT = process.cwd();
  const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8545';

  // Load JSON configs
  const addressesPath = path.join(ROOT, 'scripts', 'addresses.json');
  const contractsPath = path.join(ROOT, 'scripts', 'contracts.json');
  const addresses: AddressesJson = JSON.parse(fs.readFileSync(addressesPath, 'utf8'));
  const contracts: ContractsJson = JSON.parse(fs.readFileSync(contractsPath, 'utf8'));

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const fhe = await initFhevm(provider);

  // Token map and ABI
  const tokenMap: Record<string, `0x${string}`> = {
    cUSDT: contracts.TOKEN_CUSDT_ADDRESS,
    cBTC: contracts.TOKEN_CBTC_ADDRESS,
  };
  const erc20Abi = [
    'function name() view returns (string)',
    'function symbol() view returns (string)',
    'function decimals() view returns (uint8)',
    // self-grants decryption to msg.sender; must use .staticCall with { from }
    'function selfBalanceForCaller() returns (bytes32 eBal)'
  ];

  // Prepare list of accounts from addresses.json
  const accounts = addresses.accounts;
  if (!accounts?.length) throw new Error('No accounts found in scripts/addresses.json');

  for (const [sym, tokenAddr] of Object.entries(tokenMap)) {
    const tokenRead = new ethers.Contract(tokenAddr, erc20Abi, provider);
    const [tName, tSymbol, tDecimals] = await Promise.all([
      tokenRead.name(),
      tokenRead.symbol(),
      tokenRead.decimals(),
    ]);

    console.log(`\nToken ${sym}: ${tName} (${tSymbol}) at ${tokenAddr} — decimals=${tDecimals}`);

    // filter admin /// accounts.filter((a) => a.index !== 0))
    for (const acct of accounts) {
      const wallet = new ethers.Wallet(acct.privateKey, provider);
      const fromAddr = await wallet.getAddress();

      // Call non-view helper via staticCall to get ciphertext handle
      const eBal: string = await (tokenRead as any).selfBalanceForCaller.staticCall({ from: fromAddr });

      // Attempt decryption; even zero balances are valid to decrypt
      let raw = 0n;
      try {
        const asHex = ethers.hexlify(eBal) as `0x${string}`;
        raw = await decryptEuint64(fhe, asHex, wallet, tokenAddr);
      } catch (err: any) {
        const msg = err?.message || err?.shortMessage || String(err);
        console.error(`  [${sym}] ${fromAddr} — decrypt failed: ${msg}`);
        continue;
      }

      const human = ethers.formatUnits(raw, tDecimals);
      console.log(`  [${sym}] ${fromAddr} -> ${human} (raw=${raw})`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
