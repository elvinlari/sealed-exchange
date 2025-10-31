import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { ethers } from "ethers";

const RECIPRICAL_SCALE = 1_000_000_000_000n;
const BASE_SCALE = 100_000_000n;
const QUOTE_SCALE = 1_000_000n;
const MAX_ORDERS = 4;
const CLOSEWINDOWSEC = 60; // 1 minute
const LAST_PRICE = 110000; // BTC/USDT from TradingView
const btcIdBytes32 = ethers.id("cBTC");
const usdtIdBytes32 = ethers.id("cUSDT");


function buildGeometricTicks({
  P0,            // e.g., 60000  (USDT per BTC)
  bandPct,       // e.g., 0.25   (±25%)
  stepBps,       // e.g., 50     (0.50% per tick)
  quoteDecimals, // 6 for cUSDT
}: { P0: number; bandPct: number; stepBps: number; quoteDecimals: number; }): bigint[] {
  const lower = P0 * (1 - bandPct);
  const upper = P0 * (1 + bandPct);
  const r = 1 + stepBps / 10_000; // bps -> ratio
  // start at the lowest tick <= lower by stepping down from P0
  let p = P0;
  while (p / r >= lower) p /= r;
  const out: bigint[] = [];
  let last = -1n;
  while (p <= upper) {
    const scaled = BigInt(Math.round(p * 10 ** quoteDecimals)); // uint64-scaled price
    if (scaled !== last) out.push(scaled);
    last = scaled;
    p *= r;
  }
  // safety: ensure strictly increasing and non-zero
  return out.filter((v, i, a) => v > 0n && (i === 0 || v > a[i - 1]));
}


// cBTC/cUSDT params
const ticks = buildGeometricTicks({
  P0: LAST_PRICE,       // current fair price
  bandPct: 0.10,   // ±10%
  stepBps: 350,     // 3.50% per step >> 4 orders
  quoteDecimals: 6 // cUSDT has 6 decimals
});

const cappedTicks = ticks.slice(0, 64); // MarketPair max ticks is 64

console.log(`ticks length = ${cappedTicks.length}`);
console.log(`first 5 =`, cappedTicks.slice(0, 5).map(String));
console.log(`last 5  =`, cappedTicks.slice(-5).map(String));

const recip = cappedTicks.map((price) => {
  return (BASE_SCALE * RECIPRICAL_SCALE) / price;
});

console.log(`reciprocals length = ${recip.length}`);
console.log(`first 5 =`, recip.slice(0, 5).map(String));
console.log(`last 5  =`, recip.slice(-5).map(String));


// set lastPIdx price from external market data and find its index in ticks
const lastP = LAST_PRICE; // from TradingView
const lastPScaled = BigInt(Math.round(lastP * Number(QUOTE_SCALE)));
let lastPIdx = cappedTicks.findIndex((v) => v >= lastPScaled);
if (lastPIdx === -1) lastPIdx = cappedTicks.length - 1; // clamp to max tick
console.log(`lastPIdx = ${lastPIdx} for lastP = ${lastP} (scaled: ${lastPScaled})`);    

console.log(`cBTC assetId: ${btcIdBytes32}`); // 0xcaad1f45135feeb0e9d7d24300477e3027cc62b75d72b22367a82fd870000845
console.log(`cUSDT assetId: ${usdtIdBytes32}`); // 0xd010e8c9393965b2e6fb1d28e8485d90bf8a0a032cd79943a8788efb6f0bd3e3

const mpBTCUSDT: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;
  const vault = await hre.deployments.get("Vault");

  const deployed = await deploy("MarketPair", {
    from: deployer,
  args: [
        vault.address,// vault address
        btcIdBytes32, // baseAssetId
        usdtIdBytes32,// quoteAssetId
        QUOTE_SCALE,// qscale (1e6 for cUSDT)
        BASE_SCALE,// bscale (1e8 for cBTC)
        cappedTicks,// tickPrices
        MAX_ORDERS,// maxOrders
        lastPIdx, // lastPIdx
        RECIPRICAL_SCALE, // reciprocal scale
        recip,    // price reciprocals
        CLOSEWINDOWSEC, // closeWindowSeconds
    ],
    log: true,
  });

  console.log(`MarketPair cBTC/cUSDT contract: `, deployed.address);
};
export default mpBTCUSDT;
mpBTCUSDT.id = "deploy_marketpair_btcusdt"; // id required to prevent reexecution
mpBTCUSDT.tags = ["MarketPairBTCUSDT"];
// Ensure Vault is deployed before this script runs
mpBTCUSDT.dependencies = ["Vault"];
