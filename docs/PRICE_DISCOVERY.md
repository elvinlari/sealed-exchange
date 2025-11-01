# Price Discovery (Batch Auction)

This page explains how Sealed Exchange computes the single clearing price for each batch while preserving order privacy.

## TL;DR

- Orders are submitted on a public tick ladder (discrete prices).
- Quantities are encrypted; only ticks are public.
- For each tick, we aggregate encrypted demand and supply in BASE units, build cumulative curves, and choose the tick that maximizes executed volume. Ties break by minimum imbalance, then by proximity to the previous clearing tick.
- The selected price and matched volume are kept encrypted on-chain.

## Notation

- Ticks: indices `i ∈ {0, …, T–1}` with strictly increasing public prices `price[i]` (QUOTE per 1 BASE), scaled by `QSCALE = 10^q`.
- Scales: `BSCALE = 10^b` where `b` is BASE decimals.
- Buy order at tick `i` is funded in QUOTE; sell order is sized in BASE.
- Conversions (integer, floor division):
  - baseRaw = ⌊ quoteRaw × BSCALE / priceScaled ⌋
  - quoteRaw = ⌊ baseRaw × priceScaled / BSCALE ⌋

## Per‑tick encrypted sums

- Supply at tick i (BASE units):
  - S_at[i] = Σ BASE_sell_qty at tick i
- Demand at tick i (BASE units):
  - Convert each buy’s QUOTE to BASE at its own limit tick price, then sum:
  - D_at[i] = Σ ⌊ QUOTE_buy_qty × BSCALE / price[i] ⌋ over buys at tick i

All D_at and S_at are maintained as encrypted `euint64` values.

## Cumulative curves

Define cumulative supply from left to right (low→high ticks):

- cumS[j] = Σ_{k=0..j} S_at[k]

Define cumulative demand from right to left (high→low ticks):

- cumD[i] = Σ_{k=i..T-1} D_at[k]

Both cumS and cumD are computed entirely under FHE without revealing intermediate values.

## Executable volume at a tick

For each tick i, the encrypted executable volume is:

- V(i) = min(cumD[i], cumS[i])
- Imbalance(i) = |cumD[i] − cumS[i]|
- Dist(i) = |i − lastPIdx| (distance to previous clearing tick, also handled in encrypted form)

## Selection rule (deterministic)

Among all ticks i, choose the tick that optimizes this lexicographic criterion:

1) Maximize V(i)
2) Minimize Imbalance(i)
3) Minimize Dist(i)

The winner’s index i*, its price price[i*], reciprocal, and matched volume V(i*) remain encrypted. The contract emits an event with encrypted fields so off‑chain authorized viewers can decrypt if allowed.

## Edge cases and guards

- If a batch has only buys or only sells, no crossing is possible. All reserved funds are released, the batch is rolled forward, and accumulators are cleared.
- Ticks must be strictly increasing and within configured limits.
- All arithmetic uses integers; conversion and division truncate toward zero, which is safe and conservative.

## Complexity

- Per batch: O(N + T), where N = orders in the batch, T = tick count (both are capped).
- Memory: O(T) for accumulators and cumulative arrays.

## After price is chosen (settlement overview)

Settlement happens in a separate step:

- The matched volume V(i*) is tracked in BASE units (encrypted).
- Each qualifying order (BUY with limit ≥ i*, SELL with limit ≤ i*) is settled at the single clearing price. Partial fills are allowed unless an order explicitly disallows partial fills.
- Settlement proceeds in submission order (price–time), and any unfilled reserved amounts are released back to the trader.

## Small illustrative example (plaintext)

Assume three ticks with prices [90, 100, 110] QUOTE per 1 BASE. Orders:

- Buys: 1000 QUOTE @110, 1000 QUOTE @100
- Sells: 18 BASE @90, 1 BASE @100

Converted demand in BASE per tick:

- D_at[2]= ⌊1000×BSCALE/110⌋, D_at[1]= ⌊1000×BSCALE/100⌋, D_at[0]=0

Supply per tick: S_at[0]=18, S_at[1]=1, S_at[2]=0

Cumulatives:

- cumS = [18, 19, 19]
- cumD from right: cumD[2]=D_at[2], cumD[1]=D_at[2]+D_at[1], cumD[0]=same as cumD[1]

Executable volumes:

- V(2)=min(cumD[2],19), V(1)=min(cumD[1],19), V(0)=min(cumD[1],18)

Select i* maximizing V; if tied, minimize imbalance, then distance to previous tick.

Note: In production, all quantities and comparisons above are computed under FHE; the example is only for intuition.

## Where this lives in code

- Contract: `contracts/MarketPair.sol`
  - Per‑tick sums: `_dAt`, `_sAt`
  - Cumulative supply: `cumS`
  - Scan and selection: `finalizeBatch()` with `_updateBest()`
  - Settlement: `settleBatch()`

