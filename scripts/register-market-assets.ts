import 'dotenv/config';
import { ethers } from 'ethers';
import { NonceManager } from 'ethers';
import fs from 'node:fs';
import path from 'node:path';

interface ContractsJson {
  VAULT_ADDRESS: `0x${string}`;
  TOKEN_CUSDT_ADDRESS: `0x${string}`;
  TOKEN_CBTC_ADDRESS: `0x${string}`;
  MARKET_CBTC_CUSDT_ADDRESS: `0x${string}`;
}

function parseArgs(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        out[key] = true;
      } else {
        out[key] = next;
        i++;
      }
    }
  }
  return out;
}

function assetIdFor(sym: string, chainId: bigint, addr: string): `0x${string}` {
  if (sym === 'cBTC') return ethers.id('cBTC') as `0x${string}`;
  if (sym === 'cUSDT') return ethers.id('cUSDT') as `0x${string}`;
  const enc = ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'address'], [chainId, addr]);
  return ethers.keccak256(enc) as `0x${string}`;
}

async function main() {
  const ROOT = process.cwd();
  const args = parseArgs(process.argv.slice(2));

  const RPC_URL = (args.rpc as string) || process.env.RPC_URL || 'http://127.0.0.1:8545';
  const pk = (args.pk as `0x${string}`) || (process.env.PRIVATE_KEY as `0x${string}`) ||
    // default Hardhat account[0]
    ('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as `0x${string}`);

  // Load deployment addresses
  const contractsPath = path.join(ROOT, 'scripts', 'contracts.json');
  const contracts: ContractsJson = JSON.parse(fs.readFileSync(contractsPath, 'utf8'));

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(pk, provider);
  // Wrap in NonceManager to avoid nonce races on automining networks
  let walletNm = new NonceManager(wallet);
  const { chainId } = await provider.getNetwork();

  const VAULT = contracts.VAULT_ADDRESS;
  const TOKEN_cUSDT = contracts.TOKEN_CUSDT_ADDRESS;
  const TOKEN_cBTC = contracts.TOKEN_CBTC_ADDRESS;
  const MARKET = contracts.MARKET_CBTC_CUSDT_ADDRESS;

  // Vault admin ABI
  const vaultAbi = [
    'function registerAsset(bytes32 assetId, address token, bool isNumeraire) external',
    'function setMarketApproved(address market, bool approved) external',
    'function getAsset(bytes32 assetId) view returns (address token, bool enabled, bool paused, bool isNumeraire)',
    'function isMarket(address) view returns (bool)'
  ];
  let vault = new ethers.Contract(VAULT, vaultAbi, walletNm);

  // Compute asset IDs
  const assetId_cBTC = assetIdFor('cBTC', chainId, TOKEN_cBTC);
  const assetId_cUSDT = assetIdFor('cUSDT', chainId, TOKEN_cUSDT);

  console.log('Registering assets and approving market...');
  console.log('Vault: ', VAULT);
  console.log('Market:', MARKET);
  console.log('cBTC token:', TOKEN_cBTC, 'assetId:', assetId_cBTC);
  console.log('cUSDT token:', TOKEN_cUSDT, 'assetId:', assetId_cUSDT);

  // Helper: robust send that retries on NONCE_EXPIRED by resyncing nonce
  async function safeSend<T>(sender: () => Promise<ethers.TransactionResponse>): Promise<string> {
    let lastErr: any = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const tx = await sender();
        await tx.wait();
        return tx.hash;
      } catch (e: any) {
        lastErr = e;
        const msg = (e?.message || e?.shortMessage || e?.info?.error?.message || '').toString();
        const code = e?.code || e?.info?.error?.code;
        const isNonceExpired = code === 'NONCE_EXPIRED' || /Nonce too low|nonce has already been used|Nonce too high/i.test(msg);
        if (!isNonceExpired || attempt === 3) break;
        // Resync nonce and recreate NonceManager-bound contract
        const current = await provider.getTransactionCount(await wallet.getAddress(), 'latest');
        try {
          (walletNm as any).setNonce(current);
        } catch {
          walletNm = new NonceManager(wallet);
        }
        // Rebind contracts to the (potentially) refreshed NonceManager signer
        vault = new ethers.Contract(VAULT, vaultAbi, walletNm);
        // small backoff
        await new Promise((r) => setTimeout(r, 150 * attempt));
      }
    }
    throw lastErr;
  }

  // Register assets (idempotent: overwrites if already present)
  // Mark QUOTE (cUSDT) as numeraire, BASE (cBTC) as non-numeraire by default.
  let hash = await safeSend(() => vault.registerAsset(assetId_cBTC, TOKEN_cBTC, false));
  console.log('Registered cBTC', hash);

  hash = await safeSend(() => vault.registerAsset(assetId_cUSDT, TOKEN_cUSDT, true));
  console.log('Registered cUSDT (numeraire)', hash);

  // Approve market
  hash = await safeSend(() => vault.setMarketApproved(MARKET, true));
  console.log('Market approved', hash);

  // Read back and display
  const [btcInfo, usdInfo, marketOk] = await Promise.all([
    vault.getAsset(assetId_cBTC),
    vault.getAsset(assetId_cUSDT),
    vault.isMarket(MARKET),
  ]);

  console.log('cBTC asset:', btcInfo);
  console.log('cUSDT asset:', usdInfo);
  console.log('isMarket approved:', marketOk);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
