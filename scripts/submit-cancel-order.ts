import 'dotenv/config';
import { ethers, NonceManager } from 'ethers';
import fs from 'node:fs';
import path from 'node:path';
import { createFhevmInstance } from '@fhevm-sdk';

interface ContractsJson {
  MARKET_CBTC_CUSDT_ADDRESS: `0x${string}`;
  TOKEN_CUSDT_ADDRESS: `0x${string}`;
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

  const amountStr = (args.amount as string) || process.env.BUY_AMOUNT || '100';
  const tickStr = (args.tick as string) || process.env.BUY_TICK || '0';
  const tick = Number(tickStr);

  const contractsPath = path.join(ROOT, 'scripts', 'contracts.json');
  const contracts: ContractsJson = JSON.parse(fs.readFileSync(contractsPath, 'utf8'));

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(pk, provider);
  let walletNm = new NonceManager(wallet);

  const marketAddr = contracts.MARKET_CBTC_CUSDT_ADDRESS;
  const marketAbi = [
    'function submitBuy(uint8 tick, bool partialFill, bytes32 encQuoteAmount, bytes inputProof) returns (uint256 orderId, uint64 batchId)',
    'function cancelOrder(uint256 orderId)',
    'function phase() view returns (uint8)',
    'function closeTs() view returns (uint64)',
    'function currentBatchId() view returns (uint64)',
    'event Submitted(address indexed trader, uint64 batchId, uint8 side, uint8 tick, uint256 orderId)',
    'event Cancelled(address indexed trader, uint64 batchId, uint256 orderId)'
  ];
  let market = new ethers.Contract(marketAddr, marketAbi, walletNm);

  const [phase, batchId] = await Promise.all([market.phase(), market.currentBatchId()]);
  if (Number(phase) !== 0) {
    throw new Error('Batch is not OPEN; submit/cancel only allowed during OPEN');
  }

  // Prepare encrypted quote amount for submitBuy
  const quoteAbi = [
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)'
  ];
  const quoteToken = new ethers.Contract(contracts.TOKEN_CUSDT_ADDRESS, quoteAbi, provider);
  const [quoteDecimals, quoteSymbol] = await Promise.all([
    quoteToken.decimals(),
    quoteToken.symbol(),
  ]);
  const rawQuote = toRawAmount(amountStr, Number(quoteDecimals));

  const eip1193 = { request: async ({ method, params }: { method: string; params?: any[] }) => provider.send(method, params ?? []) };
  const controller = new AbortController();
  const fhe: any = await createFhevmInstance({ provider: eip1193 as any, signal: controller.signal });
  if ('setSigner' in fhe && typeof fhe.setSigner === 'function') {
    fhe.setSigner({ getAddress: async () => wallet.address, signMessage: (m: any) => wallet.signMessage(m) });
  }
  const enc = await fhe.createEncryptedInput(marketAddr, wallet.address).add64(rawQuote).encrypt();
  if (!enc?.handles?.length) throw new Error('Encryption failed: no handle');
  const handleHex = ethers.hexlify(enc.handles[0]) as `0x${string}`;
  const inputProof = enc.inputProof as `0x${string}`;

  // Robust send with nonce resync on NONCE_EXPIRED
  async function safeSend<T>(sender: () => Promise<ethers.TransactionResponse>): Promise<ethers.TransactionReceipt> {
    let lastErr: any = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const tx = await sender();
        const rcpt = await tx.wait();
        return rcpt as ethers.TransactionReceipt;
      } catch (e: any) {
        lastErr = e;
        const msg = (e?.message || e?.shortMessage || e?.info?.error?.message || '').toString();
        const code = e?.code || e?.info?.error?.code;
        const isNonceExpired = code === 'NONCE_EXPIRED' || /Nonce too low|nonce has already been used|Nonce too high/i.test(msg);
        if (!isNonceExpired || attempt === 3) break;
        const current = await provider.getTransactionCount(await wallet.getAddress(), 'latest');
        try {
          (walletNm as any).setNonce(current);
        } catch {
          walletNm = new NonceManager(wallet);
        }
        market = new ethers.Contract(marketAddr, marketAbi, walletNm);
        await new Promise((r) => setTimeout(r, 150 * attempt));
      }
    }
    throw lastErr;
  }

  console.log(`Submitting BUY: quote=${amountStr} ${quoteSymbol} (raw=${rawQuote}) @ tick=${tick} from ${wallet.address}`);
  // Dry-run to get orderId and batchId
  const [orderIdStatic, batchIdStatic]: [bigint, bigint] = await market.submitBuy.staticCall(
    tick,
    true, // partialFill
    handleHex,
    inputProof
  );

  // Send submitBuy
  const submitRcpt = await safeSend(() => market.submitBuy(tick, true, handleHex, inputProof));
  console.log(`submitBuy tx: ${submitRcpt.hash}`);
  console.log(`OrderId (static): ${orderIdStatic}, BatchId: ${batchIdStatic}`);

  // Now cancel the just-created order
  console.log(`Cancelling order ${orderIdStatic} on batch ${batchIdStatic} as ${wallet.address} @ ${marketAddr}`);
  const cancelRcpt = await safeSend(() => market.cancelOrder(orderIdStatic));

  // Parse events
  const iface = new ethers.Interface(marketAbi);
  for (const log of cancelRcpt?.logs ?? []) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === 'Cancelled') {
        const { trader, batchId: b, orderId: o } = parsed.args as any;
        console.log(`Cancelled: trader=${trader}, batchId=${b.toString?.() ?? b}, orderId=${o.toString?.() ?? o}`);
      }
    } catch {}
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
