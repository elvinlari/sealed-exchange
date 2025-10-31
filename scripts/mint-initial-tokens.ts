import 'dotenv/config';
import { ethers } from 'ethers';
import type { JsonRpcProvider } from 'ethers';
import { NonceManager } from 'ethers';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Simple helper: scale human amount to raw uint64 according to decimals
const MAX_UINT64 = (1n << 64n) - 1n;
const toRawAmount = (human: string | number, decimals: number) => {
  const humanStr = typeof human === 'number' ? human.toString() : human;
  const raw = ethers.parseUnits(humanStr, decimals);
  if (raw < 0n || raw > MAX_UINT64) throw new Error(`Amount won't fit uint64: ${raw}`);
  return raw;
};

// Minimal ABI for what we need
const erc20Abi = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function mint(address to, uint64 rawAmount) external',
];

function loadJson<T = any>(relPath: string): T {
  const full = resolve(__dirname, relPath);
  const txt = readFileSync(full, 'utf8');
  return JSON.parse(txt);
}

async function main() {
  const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8545';
  // Admin defaults to Hardhat signer #0
  const PRIVATE_KEY =
    process.env.PRIVATE_KEY ?? '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

  const provider: JsonRpcProvider = new ethers.JsonRpcProvider(RPC_URL);
  const admin = new ethers.Wallet(PRIVATE_KEY, provider);
  // Wrap with a NonceManager to avoid "nonce too low" on automining networks
  let adminNm = new NonceManager(admin);

  // Load addresses.json and contracts.json that live next to this script
  const addresses = loadJson<{ accounts: { index: number; address: string; tokens?: Record<string, number> }[] }>(
    './addresses.json'
  );
  const contracts = loadJson<{
    TOKEN_CUSDT_ADDRESS: `0x${string}`;
    TOKEN_CBTC_ADDRESS: `0x${string}`;
  }>('./contracts.json');

  const tokenMap: Record<string, { address: `0x${string}`; label: string }> = {
    cUSDT: { address: contracts.TOKEN_CUSDT_ADDRESS, label: 'cUSDT' },
    cBTC: { address: contracts.TOKEN_CBTC_ADDRESS, label: 'cBTC' },
  };

  const recipients = addresses.accounts
    .filter((a) => a.index !== 0) // exclude admin (index 0)
    .map((a) => ({ address: a.address as `0x${string}`, tokens: a.tokens ?? {} }));

  console.log(`Admin: ${admin.address}`);
  console.log(`Recipients: ${recipients.length}`);

  // Helper: robust send that retries on NONCE_EXPIRED by resyncing nonce
  async function safeMint(
    token: ethers.Contract,
    to: `0x${string}`,
    raw: bigint
  ): Promise<string> {
    let lastErr: any = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const tx = await token.mint(to, raw);
        await tx.wait();
        return tx.hash;
      } catch (e: any) {
        lastErr = e;
        const msg = (e?.message || e?.shortMessage || e?.info?.error?.message || '').toString();
        const code = e?.code || e?.info?.error?.code;
        const isNonceExpired = code === 'NONCE_EXPIRED' || /Nonce too low|nonce has already been used/i.test(msg);
        if (!isNonceExpired || attempt === 3) break;
        // Resync nonce and recreate NonceManager-bound contract
        const current = await provider.getTransactionCount(await admin.getAddress(), 'latest');
        // NonceManager in ethers v6 exposes setNonce on the signer instance
        try {
          (adminNm as any).setNonce(current);
        } catch {
          // Fallback: recreate NonceManager if setNonce is not accessible
          adminNm = new NonceManager(admin);
        }
        // small backoff
        await new Promise((r) => setTimeout(r, 150 * attempt));
      }
    }
    throw lastErr;
  }

  // Mint for each token separately to keep logging simple and avoid nonce confusion
  for (const [symbol, tokenInfo] of Object.entries(tokenMap)) {
    // Bind contract to NonceManager signer
    let token = new ethers.Contract(tokenInfo.address, erc20Abi, adminNm);
    const [name, decimals] = await Promise.all([token.name(), token.decimals()]);

    console.log(`\n== Minting ${symbol} (${name}) at ${tokenInfo.address} with ${decimals} decimals ==`);

    for (const r of recipients) {
      // Amount preference order: from addresses.json tokens map; if absent, skip
      const human = r.tokens?.[symbol];
      if (human == null) {
        console.log(`- Skip ${symbol} for ${r.address} (no amount specified)`);
        continue;
      }

      const raw = toRawAmount(human, Number(decimals));
      console.log(`- Mint ${human} ${symbol} (raw=${raw}) to ${r.address}`);

      try {
        const hash = await safeMint(token, r.address, raw);
        console.log(`  tx: ${hash}`);
      } catch (err: any) {
        const msg = err?.message || err?.shortMessage || String(err);
        console.error(`  failed: ${msg}`);
        // Recreate contract with possibly refreshed NonceManager for next iterations
        token = new ethers.Contract(tokenInfo.address, erc20Abi, adminNm);
      }
    }
  }

  console.log('\nAll minting operations completed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
