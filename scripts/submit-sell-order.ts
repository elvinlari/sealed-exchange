import 'dotenv/config';
import { ethers } from 'ethers';
import type { JsonRpcProvider } from 'ethers';
import fs from 'node:fs';
import path from 'node:path';
import { createFhevmInstance } from '@fhevm-sdk';

interface ContractsJson {
  VAULT_ADDRESS: `0x${string}`;
  TOKEN_CUSDT_ADDRESS: `0x${string}`;
  TOKEN_CBTC_ADDRESS: `0x${string}`;
  MARKET_CBTC_CUSDT_ADDRESS: `0x${string}`;
}

// uint64 helpers
const MAX_UINT64 = (1n << 64n) - 1n;
const toRawAmount = (human: string | number, decimals: number) => {
  const humanStr = typeof human === 'number' ? human.toString() : human;
  if (!humanStr || humanStr.trim() === '') throw new Error('amount missing');
  const raw = ethers.parseUnits(humanStr, decimals);
  if (raw < 0n || raw > MAX_UINT64) throw new Error(`Amount won't fit uint64: ${raw}`);
  return raw;
};

async function initFhevm(provider: JsonRpcProvider, wallet: ethers.Wallet) {
  const eip1193 = { request: async ({ method, params }: { method: string; params?: any[] }) => provider.send(method, params ?? []) };
  const controller = new AbortController();
  const instance: any = await createFhevmInstance({ provider: eip1193 as any, signal: controller.signal });
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

  // Load deployment addresses
  const contractsPath = path.join(ROOT, 'scripts', 'contracts.json');
  const contracts: ContractsJson = JSON.parse(fs.readFileSync(contractsPath, 'utf8'));

  const provider = new ethers.JsonRpcProvider(RPC_URL);

  // Resolve CLI inputs
  // Usage: tsx scripts/submit-sell-order.ts --amount 0.01 --tick 2 --pk 0x...
  const args = process.argv.slice(2);
  const getArg = (name: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const amountStr = getArg('amount') ?? process.env.SELL_AMOUNT ?? '0.001';
  const tickStr = getArg('tick') ?? process.env.SELL_TICK ?? '0';
  const pk = (getArg('pk') ?? (process.env.PRIVATE_KEY || '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d')) as `0x${string}` | undefined;
  if (!pk) throw new Error('Missing private key. Pass --pk 0x... or set PRIVATE_KEY env.');

  const wallet = new ethers.Wallet(pk, provider);

  // ABIs
  const marketAbi = [
    'function submitSell(uint8 tick, bool partialFill, bytes32 encBaseAmount, bytes inputProof) returns (uint256 orderId, uint64 batchId)',
    'function orderCount() view returns (uint256)',
    'function currentBatchId() view returns (uint64)',
    'function phase() view returns (uint8)',
    'function closeTs() view returns (uint64)',
    'function BASE_ASSET() view returns (bytes32)',
    'event Submitted(address indexed trader, uint64 batchId, uint8 side, uint8 tick, uint256 orderId)'
  ];
  const ercConfAbi = [
    'function name() view returns (string)',
    'function symbol() view returns (string)',
    'function decimals() view returns (uint8)'
  ];

  // We'll express sell amount in BASE token units (cBTC)
  const baseTokenAddr = contracts.TOKEN_CBTC_ADDRESS;
  const baseToken = new ethers.Contract(baseTokenAddr, ercConfAbi, provider);
  const [baseName, baseSymbol, baseDecimals] = await Promise.all([
    baseToken.name(),
    baseToken.symbol(),
    baseToken.decimals(),
  ]);

  const marketAddr = contracts.MARKET_CBTC_CUSDT_ADDRESS;
  const market = new ethers.Contract(marketAddr, marketAbi, wallet);

  // Sanity: open phase and time remaining
  const [phase, closeTs] = await Promise.all([market.phase(), market.closeTs()]);
  if (Number(phase) !== 0) {
    console.warn('Warning: Batch is frozen; order may revert. Consider waiting for next OPEN batch.');
  } else {
    const now = Math.floor(Date.now() / 1000);
    const remain = Number(closeTs) - now;
    console.log(`Intake window open. ~${Math.max(remain, 0)}s remaining.`);
  }

  // Prepare encrypted base amount for MarketPair contract
  const rawBase = toRawAmount(amountStr, Number(baseDecimals));
  const fhe = await initFhevm(provider, wallet);
  const enc = await (fhe as any)
    .createEncryptedInput(marketAddr, wallet.address)
    .add64(rawBase)
    .encrypt();
  if (!enc?.handles?.length) throw new Error('Encryption failed: no handle');

  const handleHex = ethers.hexlify(enc.handles[0]) as `0x${string}`;
  const inputProof = enc.inputProof as `0x${string}`;

  const tick = Number(tickStr);
  console.log(`Submitting SELL: base=${amountStr} ${baseSymbol} (raw=${rawBase}) @ tick=${tick} from ${wallet.address}`);

  const partialFill = true; // allow partial fills  
  // Predict orderId and batchId without staticCall (which would revert due to state writes)
  const [predOrderCount, predBatchId]: [bigint, bigint] = await Promise.all([
    market.orderCount(),
    market.currentBatchId(),
  ]);

  const tx = await market.submitSell(tick, partialFill, handleHex, inputProof);
  console.log(`submitSell tx: ${tx.hash}`);
  const receipt = await tx.wait();

  // Try to parse Submitted event for confirmed ids
  try {
    const iface = new ethers.Interface(marketAbi);
    const submitted = receipt!.logs
      .map((l: any) => {
        try { return iface.parseLog(l); } catch { return null; }
      })
      .filter((x: any) => x && x.name === 'Submitted')[0] as any;
    if (submitted) {
      const { args } = submitted;
      console.log(`Submitted event → trader=${args.trader}, batchId=${args.batchId}, side=${args.side}, tick=${args.tick}, orderId=${args.orderId}`);
    } else {
      console.log('Submitted event not found in receipt logs.');
    }
  } catch (e) {
    console.log('Could not parse Submitted event:', e);
  }

  const countAfter: bigint = await market.orderCount();
  console.log(`Predicted (orderId=${predOrderCount}, batchId=${predBatchId}) → orderCount after: ${countAfter}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
