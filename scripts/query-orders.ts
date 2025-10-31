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

type TraderOrderRow = {
  orderId: bigint;
  batchId: bigint;
  side: number; // 0=BUY, 1=SELL
  tick: number;
  partialFill: boolean;
  settled: boolean;
  cancelled: boolean;
};

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
    // default Hardhat account[1] (not the usual [0], to avoid conflicts with other scripts)
    ('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as `0x${string}`);
  const whoArg = args.account as string | undefined;

  const contractsPath = path.join(ROOT, 'scripts', 'contracts.json');
  const contracts: ContractsJson = JSON.parse(fs.readFileSync(contractsPath, 'utf8'));

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(pk, provider);
  const who = (whoArg ?? wallet.address) as `0x${string}`;

  const marketAddr = ((args.market as `0x${string}`) || contracts.MARKET_CBTC_CUSDT_ADDRESS) as `0x${string}`;
  const baseTokenAddr = contracts.TOKEN_CBTC_ADDRESS;
  const quoteTokenAddr = contracts.TOKEN_CUSDT_ADDRESS;

  const marketAbi = [
    'function MAX_TICKS() view returns (uint8)',
    'function priceAt(uint8 tick) view returns (uint64)',
    'function getMyOrders() view returns ((uint256 orderId,uint64 batchId,uint8 side,uint8 tick,bool partialFill,bool settled,bool cancelled)[])',
    'event Submitted(address indexed trader, uint64 batchId, uint8 side, uint8 tick, uint256 orderId)',
    'event Cancelled(address indexed trader, uint64 batchId, uint256 orderId)'
  ];
  const tokenAbi = [
    'function symbol() view returns (string)',
    'function decimals() view returns (uint8)'
  ];

  const market = new ethers.Contract(marketAddr, marketAbi, provider);
  const baseToken = new ethers.Contract(baseTokenAddr, tokenAbi, provider);
  const quoteToken = new ethers.Contract(quoteTokenAddr, tokenAbi, provider);

  const [baseSymbol, quoteSymbol, baseDecimals, quoteDecimals] = await Promise.all([
    baseToken.symbol(),
    quoteToken.symbol(),
    baseToken.decimals(),
    quoteToken.decimals(),
  ]);

  const tickPriceCache = new Map<number, string>();
  const getPriceHuman = async (tick: number) => {
    if (tickPriceCache.has(tick)) return tickPriceCache.get(tick)!;
    const raw = await market.priceAt(tick);
    const human = ethers.formatUnits(raw, Number(quoteDecimals));
    tickPriceCache.set(tick, human);
    return human;
  };

  type UserOrder = {
    orderId: string;
    batchId: string;
    side: 'BUY' | 'SELL';
    tick: number;
    price: string; // human price
    status: 'SUBMITTED' | 'CANCELLED' | 'SETTLED';
  };

  const resultOrders: UserOrder[] = [];

  // Path A: on-chain view (fast). Uses msg.sender, so we must set the from override; no tx needed.
  let usedView = false;
  try {
    const rows: TraderOrderRow[] = await market.getMyOrders.staticCall({ from: who });
    for (const r of rows) {
      const price = await getPriceHuman(r.tick);
      resultOrders.push({
        orderId: r.orderId.toString(),
        batchId: r.batchId.toString(),
        side: r.side === 0 ? 'BUY' : 'SELL',
        tick: Number(r.tick),
        price,
        status: r.cancelled ? 'CANCELLED' : (r.settled ? 'SETTLED' : 'SUBMITTED'),
      });
    }
    usedView = true;
  } catch {}

  // Path B: fallback to events if view unavailable or empty
  if (!usedView || resultOrders.length === 0) {
    // Submitted events for this trader
    const submittedFilter = market.filters.Submitted(who);
    const submittedEvents = await market.queryFilter(submittedFilter, 0, 'latest');

    const cancelledFilter = market.filters.Cancelled(who);
    const cancelledEvents = await market.queryFilter(cancelledFilter, 0, 'latest');
    const cancelledIds = new Set(cancelledEvents.map((e: any) => e.args?.orderId?.toString()).filter(Boolean));

    for (const ev of submittedEvents) {
      const e = ev as ethers.EventLog;
      if (!e.args) continue;
      const tick = Number(e.args.tick);
      const orderId = e.args.orderId.toString();
      const batchId = e.args.batchId.toString();
      const side = Number(e.args.side) === 0 ? 'BUY' : 'SELL';
      const price = await getPriceHuman(tick);
      const status = cancelledIds.has(orderId) ? 'CANCELLED' : 'SUBMITTED';
      resultOrders.push({ orderId, batchId, side, tick, price, status });
    }
  }

  // Sort by orderId desc (rough recency)
  resultOrders.sort((a, b) => Number(b.orderId) - Number(a.orderId));

  const asJson = !!args.json;
  if (asJson) {
    console.log(JSON.stringify({
      market: marketAddr,
      account: who,
      baseSymbol,
      quoteSymbol,
      orders: resultOrders,
    }, null, 2));
  } else {
    console.log(`Account: ${who}`);
    console.log(`Market:  ${marketAddr}`);
    console.log(`Pair:    ${baseSymbol}/${quoteSymbol}`);
    if (resultOrders.length === 0) {
      console.log('No orders found');
      return;
    }
    for (const o of resultOrders) {
      console.log(`- #${o.orderId} [${o.status}] ${o.side} @ tick ${o.tick} ~ ${o.price} ${quoteSymbol} (batch ${o.batchId})`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
