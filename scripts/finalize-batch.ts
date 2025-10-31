import 'dotenv/config';
import { ethers } from 'ethers';
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

async function main() {
  const ROOT = process.cwd();
  const args = parseArgs(process.argv.slice(2));

  const RPC_URL = (args.rpc as string) || process.env.RPC_URL || 'http://127.0.0.1:8545';
  const pk = (args.pk as `0x${string}`) || (process.env.PRIVATE_KEY as `0x${string}`) ||
    // default Hardhat account[0]
    ('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as `0x${string}`);
  const shouldWait = ((): boolean => {
    const v = args.wait ?? process.env.FINALIZE_WAIT ?? 'true';
    if (typeof v === 'boolean') return v;
    const s = String(v).toLowerCase();
    return s === '1' || s === 'true' || s === 'yes';
  })();

  // Load deployment addresses
  const contractsPath = path.join(ROOT, 'scripts', 'contracts.json');
  const contracts: ContractsJson = JSON.parse(fs.readFileSync(contractsPath, 'utf8'));

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(pk, provider);

  const marketAddr = contracts.MARKET_CBTC_CUSDT_ADDRESS;

  const marketAbi = [
    'function finalizeBatch()',
    'function phase() view returns (uint8)',
    'function closeTs() view returns (uint64)',
    'function orderCount() view returns (uint256)',
    'function currentBatchId() view returns (uint64)'
  ];
  const market = new ethers.Contract(marketAddr, marketAbi, wallet);

  const [phase, closeTsBn, countBefore, batchIdBefore] = await Promise.all([
    market.phase(),
    market.closeTs(),
    market.orderCount(),
    market.currentBatchId(),
  ]);

  const now = Math.floor(Date.now() / 1000);
  const closeTs = Number(closeTsBn);

  if (BigInt(countBefore) === 0n) {
    console.log('No orders in current batch. Nothing to finalize.');
    return;
  }

  if (Number(phase) !== 0) {
    console.log('Batch is already frozen; finalizeBatch() requires OPEN. Use admin settleWithPrice if applicable.');
    return;
  }

//   if (now < closeTs) {
//     if (!shouldWait) {
//       console.log(`Batch intake still open for ${closeTs - now}s. Re-run later or pass --wait to wait until close.`);
//       return;
//     }
//     const waitSec = closeTs - now;
//     console.log(`Waiting ${waitSec}s for intake window to close (closeTs=${closeTs})...`);
//     await new Promise((r) => setTimeout(r, waitSec * 1000));
//   }

  // before calling finalizeBatch()
    await provider.send('evm_increaseTime', [60]);   // advance 60s (or more)
    await provider.send('evm_mine', []);             // mine a block

//   // Dry-run to catch reverts
//   try {
//     await market.finalizeBatch.staticCall();
//   } catch (e: any) {
//     console.error('Dry-run revert:', e?.reason || e?.shortMessage || e?.message || e);
//     process.exit(1);
//   }

  console.log(`Calling finalizeBatch() from ${wallet.address} on ${marketAddr}...`);
  const tx = await market.finalizeBatch({ gasLimit: 15_000_000 });
  console.log('tx hash:', tx.hash);
  const rcpt = await tx.wait();
  console.log('Finalized. receipt:', rcpt?.hash ?? rcpt?.transactionHash);

  const [phaseAfter, countAfter, batchIdAfter] = await Promise.all([
    market.phase(),
    market.orderCount(),
    market.currentBatchId(),
  ]);

  console.log(`Phase after: ${Number(phaseAfter)} (0=OPEN,1=FROZEN)`);
  console.log(`Order count after: ${countAfter.toString?.() ?? String(countAfter)}`);
  console.log(`Batch moved: ${Number(batchIdBefore)} -> ${Number(batchIdAfter)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
