import 'dotenv/config';
import { ethers } from 'ethers';
import type { JsonRpcProvider } from 'ethers';
import fs from 'node:fs';
import path from 'node:path';
import { createFhevmInstance } from '@fhevm-sdk';

// Data shapes
interface AccountEntry {
  index: number;
  address: `0x${string}`;
  privateKey: `0x${string}`;
  tokens?: Record<string, number | string>;
  vault?: { available?: Record<string, number | string> };
}
interface AddressesJson { accounts: AccountEntry[] }
interface ContractsJson {
  VAULT_ADDRESS: `0x${string}`;
  TOKEN_CUSDT_ADDRESS: `0x${string}`;
  TOKEN_CBTC_ADDRESS: `0x${string}`;
  MARKET_CBTC_CUSDT_ADDRESS?: `0x${string}`;
}

// uint64 bounds
const MAX_UINT64 = (1n << 64n) - 1n;
const toRawAmount = (human: string | number, decimals: number) => {
  const humanStr = typeof human === 'number' ? human.toString() : human;
  if (humanStr.trim() === '') throw new Error('empty amount');
  const raw = ethers.parseUnits(humanStr, decimals);
  if (raw < 0n || raw > MAX_UINT64) throw new Error(`Amount won't fit uint64: ${raw}`);
  return raw;
};

async function initFhevm(provider: JsonRpcProvider, wallet: ethers.Wallet) {
  const eip1193 = {
    request: async ({ method, params }: { method: string; params?: any[] }) =>
      provider.send(method, params ?? []),
  };
  const controller = new AbortController();
  const instance: any = await createFhevmInstance({ provider: eip1193 as any, signal: controller.signal });
  // set signer if supported (used by some SDK methods)
  if ('setSigner' in instance && typeof instance.setSigner === 'function') {
    instance.setSigner({
      getAddress: async () => wallet.address,
      signMessage: (msg: string | Uint8Array) => wallet.signMessage(msg as any),
    });
  }
  return instance as any;
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

  const VAULT_ADDRESS = contracts.VAULT_ADDRESS;

  // Map logical symbols to token addresses
  const tokenMap: Record<string, `0x${string}`> = {
    cUSDT: contracts.TOKEN_CUSDT_ADDRESS,
    cBTC: contracts.TOKEN_CBTC_ADDRESS,
  };

  // ABIs
  const tokenAbi = [
    'function name() view returns (string)',
    'function decimals() view returns (uint8)',
    'function transferEncryptedAndNotify(address vault, bytes32 assetId, bytes32 encAmount, bytes inputProof) returns (bool)'
  ];
  const vaultViewAbi = [
    'function isAcceptingDeposits(bytes32 assetId) view returns (bool)',
    'function getAsset(bytes32) view returns (address token, bool enabled, bool paused, bool isNumeraire)'
  ];

  // Resolve per-token settings (decimals, assetId) and sanity-check vault registry
  const perToken: Record<string, { address: `0x${string}`; name: string; decimals: number; assetId: `0x${string}` }>= {};
  const vault = new ethers.Contract(VAULT_ADDRESS, vaultViewAbi, provider);
  const { chainId } = await provider.getNetwork();

  for (const [sym, addr] of Object.entries(tokenMap)) {
    const tokenRead = new ethers.Contract(addr, tokenAbi, provider);
    const [name, decimals] = await Promise.all([tokenRead.name(), tokenRead.decimals()]);
    // Derive assetId by symbol as per Vault convention (e.g., bytes32(keccak256("cUSDT")))
    const assetId = (
      sym === 'cBTC' ? ethers.id('cBTC') :
      sym === 'cUSDT' ? ethers.id('cUSDT') :
      // Fallback for unknown symbols: chainId+token address
      (ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'address'], [chainId, addr])
      ) as `0x${string}`)
    ) as `0x${string}`;

    const [va, enabled, paused] = await vault.getAsset(assetId);
    if (va.toLowerCase() !== addr.toLowerCase()) {
      throw new Error(`[${sym}] assetId not registered to token in Vault (found ${va})`);
    }
    const accepting = await vault.isAcceptingDeposits(assetId);
    if (!accepting || !enabled || paused) {
      throw new Error(`[${sym}] Vault not accepting deposits for this asset (enabled=${enabled}, paused=${paused})`);
    }

    perToken[sym] = { address: addr, name, decimals: Number(decimals), assetId };
  }

  // Iterate accounts and deposit requested vault.available amounts
  const accounts = addresses.accounts ?? [];
  console.log(`Preparing deposits into Vault ${VAULT_ADDRESS}`);

  for (const acct of accounts) {
    const avail = acct.vault?.available || {};
    // Skip admin or any account with empty desired amounts
    const symbols = Object.keys(avail).filter((k) => avail[k] !== '' && avail[k] != null);
    if (!symbols.length) continue;

    const wallet = new ethers.Wallet(acct.privateKey, provider);

    for (const sym of symbols) {
      const cfg = perToken[sym];
      if (!cfg) {
        console.warn(`Skip unknown token symbol ${sym} for ${acct.address}`);
        continue;
      }
      const amountHuman = avail[sym]!;
      try {
        const raw = toRawAmount(amountHuman as any, cfg.decimals);

        // Initialize SDK for this signer and encrypt amount for token contract
        const fhe = await initFhevm(provider, wallet);
        const enc = await (fhe as any)
          .createEncryptedInput(cfg.address, wallet.address)
          .add64(raw)
          .encrypt();
        if (!enc?.handles?.length) throw new Error('Encryption failed: no handle');

        const handleHex = ethers.hexlify(enc.handles[0]) as `0x${string}`;
        const inputProof = enc.inputProof as `0x${string}`;

        const token = new ethers.Contract(cfg.address, tokenAbi, wallet);

        // Optional dry-run
        await token.transferEncryptedAndNotify.staticCall(
          VAULT_ADDRESS,
          cfg.assetId,
          handleHex,
          inputProof
        );

        const tx = await token.transferEncryptedAndNotify(
          VAULT_ADDRESS,
          cfg.assetId,
          handleHex,
          inputProof
        );
        console.log(`Deposited ${amountHuman} ${sym} from ${acct.address} -> tx: ${tx.hash}`);
        await tx.wait();
      } catch (err: any) {
        const msg = err?.reason || err?.shortMessage || err?.message || String(err);
        console.error(`Failed deposit for ${sym} by ${acct.address}: ${msg}`);
      }
    }
  }

  console.log('All requested vault deposits processed.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
