# Smart Contracts

## Overview

Sealed Exchange uses three main contracts for private, on-chain trading:

1. **ConfidentialERC20** - FHE-encrypted tokens
2. **Vault** - Central balance ledger
3. **MarketPair** - Batch auction matching

---

## ConfidentialERC20

**FHE-encrypted ERC20 token with private balances.**

### Key Features
- All balances/allowances encrypted as `euint64`
- Standard ERC20 interface (transfer, approve, transferFrom)
- Direct deposit to Vault via `transferEncryptedAndNotify()`
- Owner can mint/burn
- Auditor role for compliance

### Main Functions

**User Operations:**
- `transfer(to, encAmount, proof)` - Transfer tokens
- `approve(spender, amount)` - Approve allowance
- `transferFrom(from, to, amount)` - Transfer from allowance
- `transferEncryptedAndNotify(vault, assetId, encAmount, proof)` - Deposit to Vault

**Owner Operations:**
- `mint(to, rawAmount)` - Mint new tokens (plaintext)
- `burn(rawAmount)` - Burn tokens
- `grantAuditorRole(auditor)` / `revokeAuditorRole(auditor)` - Manage auditors

**Views:**
- `balanceOf(account) → euint64` - Get encrypted balance
- `selfBalanceForCaller() → euint64` - Grant caller access to decrypt their balance
- `balanceOfForCaller(account) → euint64` - View any balance (auditor only)

---

## Vault

**Central custody managing encrypted balances for all traders.**

### Key Features
- Per-trader, per-asset encrypted balances (available vs reserved)
- Asset registry (tokens, enabled/paused status)
- Market approval system
- Reserve/release/settle interface for markets

### Main Functions

**Admin Operations:**
- `registerAsset(assetId, token, isNumeraire)` - Register new token
- `setAssetStatus(assetId, enabled, paused)` - Enable/disable deposits
- `setMarketApproved(market, approved)` - Approve market contracts
- `grantAuditorRole(auditor)` / `revokeAuditorRole(auditor)` - Manage auditors

**User Operations:**
- `withdraw(assetId, encAmount, proof)` - Withdraw tokens to wallet
- `onDepositFromToken(owner, assetId, amt)` - Receive deposit (called by token)

**Market Operations:**
- `reserveFor(trader, assetId, batchId, eAmt)` - Lock funds for order
- `releaseFor(trader, assetId, batchId, eAmt)` - Return unused funds
- `settleBuy(buyer, baseAsset, quoteAsset, batchId, eBaseFill, eQuoteDebit)` - Execute buy
- `settleSell(seller, baseAsset, quoteAsset, batchId, eBaseDebit, eQuoteCredit)` - Execute sell

**Views:**
- `selfGetBalancesForCaller(assetId) → (available, reserved)` - Your balances
- `getBalancesForCaller(trader, assetId) → (available, reserved)` - Any balance (auditor only)

---

## MarketPair

**Encrypted batch auction implementing Walrasian price discovery.**

### Key Features
- Public tick-based price ladder
- Encrypted order quantities and clearing price
- Time-based batch windows (~60 seconds)
- BUY/SELL orders with optional partial fills
- Constant-time FHE operations (no timing leaks)

### Main Functions

**Trading Operations:**
- `submitBuy(tick, partialFill, encQuoteAmount, proof) → (orderId, batchId)` - Place buy order
- `submitSell(tick, partialFill, encBaseAmount, proof) → (orderId, batchId)` - Place sell order
- `cancelOrder(orderId)` - Cancel order before finalization

**Batch Operations:**
- `finalizeBatch()` - Compute encrypted clearing price (anyone can call)
- `settleBatch()` - Execute all matched orders (anyone can call)

**Views:**
- `getMyOrders() → TraderOrderView[]` - Your orders in current batch
- `timeUntilClose() → uint64` - Seconds until batch closes
- `orderCount() → uint256` - Orders in current batch
- `lastTickEncForCaller() → euint64` - Previous clearing tick (encrypted)
- `lastPriceEncForCaller() → euint64` - Previous clearing price (encrypted)

### How It Works

1. **Submit Phase (OPEN)**: Users submit encrypted orders at specific ticks
2. **Finalization**: Algorithm finds clearing price (p*) that maximizes volume
3. **Settlement (FROZEN)**: Orders execute at p*, funds transfer, batch reopens

**Price Discovery:** Uses FHE operations to compare demand/supply curves and select optimal tick without revealing individual order sizes.

---

## Trading Flow

1. **Deposit**: `token.transferEncryptedAndNotify(vault, assetId, encAmount, proof)`
2. **Order**: `market.submitBuy(tick, partialFill, encQuoteAmount, proof)`
3. **Finalize**: `market.finalizeBatch()` (anyone)
4. **Settle**: `market.settleBatch()` (anyone)
5. **Withdraw**: `vault.withdraw(assetId, encAmount, proof)`

## Key Concepts

- **Encrypted Values**: All balances and orders use `euint64` (FHE-encrypted)
- **Constant-Time**: FHE operations prevent timing side-channels
- **Ticks**: Discrete price levels (public), order sizes are encrypted
- **Batch Auction**: Orders accumulate, then clear at single price
- **Access Grants**: Use `*ForCaller()` functions to decrypt off-chain

## Learn More

- [Architecture](./ARCHITECTURE.md) - System design
- [Price Discovery](./PRICE_DISCOVERY.md) - How the clearing price is computed
- [Scripts](./SCRIPTS.md) - Operational tools
