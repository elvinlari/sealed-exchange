import 'dotenv/config';
import { ethers } from 'ethers';
import type { JsonRpcProvider } from 'ethers';
import fs from 'node:fs';
import path from 'node:path';
import { createFhevmInstance } from '@fhevm-sdk';

interface AccountEntry {
  index: number;
  address: `0x${string}`;
  privateKey: `0x${string}`;
}
interface AddressesJson { accounts: AccountEntry[] }
interface ContractsJson {
  VAULT_ADDRESS: `0x${string}`;
  TOKEN_CUSDT_ADDRESS: `0x${string}`;
  TOKEN_CBTC_ADDRESS: `0x${string}`;
}

async function initFhevm(provider: JsonRpcProvider) {
  const eip1193 = {
    request: async ({ method, params }: { method: string; params?: any[] }) =>
      provider.send(method, params ?? []),
  };
  const controller = new AbortController();
  const inst: any = await createFhevmInstance({ provider: eip1193 as any, signal: controller.signal });
  return inst as any;
}

async function decryptEuint64(
  fhe: any,
  ciphertextBytes32: string,
  signer: ethers.Wallet,
  contractAddress: `0x${string}`
): Promise<bigint> {
  if (!ciphertextBytes32 || ciphertextBytes32 === '0x') return 0n;

  if (typeof fhe.userDecrypt !== 'function') {
    throw new Error('fhEVM SDK userDecrypt not found. Please update @fhevm-sdk.');
  }

  const kp = (fhe as any).generateKeypair();
  const publicKey = kp.publicKey;
  const privateKey = kp.privateKey;

  const startTimestamp = Math.floor(Date.now() / 1000);
  const durationDays = 365;

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

  // Retry transient relayer ordering errors
  let lastErr: any = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await (fhe as any).userDecrypt(
        req,
        privateKey,
        publicKey,
        signature,
        [contractAddress],
        await signer.getAddress(),
        startTimestamp,
        durationDays
      );
      if (Array.isArray(res) && res.length > 0) return BigInt(res[0]);
      if (res && typeof res === 'object') {
        if (ciphertextBytes32 in res) return BigInt((res as any)[ciphertextBytes32] as any);
        const vals = Object.values(res);
        if (vals.length > 0) return BigInt(vals[0] as any);
      }
      throw new Error('userDecrypt returned unexpected result');
    } catch (e: any) {
      lastErr = e;
      const msg = (e?.message || e?.shortMessage || e?.error?.message || '').toString();
      const parseOrder = msg.includes('Parse event') || msg.includes('backward order');
      if (!parseOrder || attempt === 3) break;
      await new Promise((r) => setTimeout(r, 150 * attempt));
    }
  }
  // If decryption fails, treat as zero per spec
  return 0n;
}

function zeroish(v: string) {
  return !v || v === '0x' || /^0x0+$/i.test(v);
}

async function main() {
  const ROOT = process.cwd();
  const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8545';

  // Load configs
  const addressesPath = path.join(ROOT, 'scripts', 'addresses.json');
  const contractsPath = path.join(ROOT, 'scripts', 'contracts.json');
  const addresses: AddressesJson = JSON.parse(fs.readFileSync(addressesPath, 'utf8'));
  const contracts: ContractsJson = JSON.parse(fs.readFileSync(contractsPath, 'utf8'));

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const fhe = await initFhevm(provider);

  const VAULT_ADDRESS = contracts.VAULT_ADDRESS;

  // Token metadata (for decimals formatting)
  const tokenMap: Record<string, `0x${string}`> = {
    cUSDT: contracts.TOKEN_CUSDT_ADDRESS,
    cBTC: contracts.TOKEN_CBTC_ADDRESS,
  };
  const erc20Abi = ['function name() view returns (string)', 'function decimals() view returns (uint8)'];

  const decimalsBySym: Record<string, number> = {};
  for (const [sym, addr] of Object.entries(tokenMap)) {
    const token = new ethers.Contract(addr, erc20Abi, provider);
    const d = await token.decimals();
    decimalsBySym[sym] = Number(d);
  }

  // Vault read ABI
  const vaultAbi = [
    'function selfGetBalancesForCaller(bytes32 assetId) view returns (bytes32 eAvailable, bytes32 eReservedAgg)'
  ];
  const vault = new ethers.Contract(VAULT_ADDRESS, vaultAbi, provider);

  // Asset IDs by symbol
  const assetIdBySym: Record<string, `0x${string}`> = {
    cUSDT: ethers.id('cUSDT') as `0x${string}`,
    cBTC: ethers.id('cBTC') as `0x${string}`,
  };

  const accounts = addresses.accounts ?? [];

  // Iterate non-admin accounts // accounts.filter((a) => a.index !== 0)
  for (const acct of accounts) {
    const wallet = new ethers.Wallet(acct.privateKey, provider);
    console.log(`\nAccount: ${wallet.address}`);

    for (const sym of Object.keys(tokenMap)) {
      const assetId = assetIdBySym[sym];
      try {
        const [eAvail, eRes] = await vault.selfGetBalancesForCaller.staticCall(
          assetId,
          { from: wallet.address }
        );

        let rawAvail = 0n;
        let rawRes = 0n;

        if (!zeroish(eAvail)) {
          const hex = ethers.hexlify(eAvail) as `0x${string}`;
          rawAvail = await decryptEuint64(fhe, hex, wallet, VAULT_ADDRESS);
        }
        if (!zeroish(eRes)) {
          const hex = ethers.hexlify(eRes) as `0x${string}`;
          rawRes = await decryptEuint64(fhe, hex, wallet, VAULT_ADDRESS);
        }

        const dec = decimalsBySym[sym] ?? 0;
        const humanAvail = ethers.formatUnits(rawAvail, dec);
        const humanRes = ethers.formatUnits(rawRes, dec);

        console.log(`  ${sym}: available=${humanAvail} (raw=${rawAvail}) reservedAgg=${humanRes} (raw=${rawRes})`);
      } catch (err: any) {
        // If anything fails (e.g., decrypt not allowed), follow spec: log zero
        const dec = decimalsBySym[sym] ?? 0;
        console.log(`  ${sym}: available=${ethers.formatUnits(0n, dec)} (raw=0) reservedAgg=${ethers.formatUnits(0n, dec)} (raw=0)`);
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
