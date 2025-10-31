# Scripts Reference

## Overview

The `scripts/` directory contains operational scripts for managing the Sealed Exchange system. These scripts handle deployment initialization, trading operations, and system monitoring.

> **⚠️ Important:** These scripts are designed for **localhost development with Hardhat** only. They use mock FHE encryption and hardcoded addresses from local deployments. For production/testnet deployments, you'll need to modify the scripts or use the UI interface.

## Script Categories

1. **Initialization** - Setup and configuration
2. **Trading** - Order submission and batch operations
3. **Balance Management** - Deposits, withdrawals, minting
4. **Monitoring** - Logging and inspection
5. **Administration** - Asset and market management

## Running Scripts

### Basic Usage

```bash
# Local network 
pnpm dlx tsx scripts/SCRIPT_NAME.ts --network localhost
```

### With Custom Parameters

Most scripts support environment variables for configuration:

```bash
# Example: Mint specific amount
AMOUNT=1000000 TOKEN=CUSDT pnpm dlx tsx scripts/mint-initial-tokens.ts --network localhost
```

## Initialization Scripts

### `register-market-assets.ts`

Register token assets in the Vault.

**Usage:**
```bash
pnpm dlx tsx scripts/register-market-assets.ts --network localhost
```

**What it does:**
- Reads deployed assets and markets addresses from `contracts.json`
- Registers each in the Vault
- Marks all assets as enabled

**Prerequisites:** Vault and tokens deployed

### `mint-initial-tokens.ts`

Mint initial token supply to all addresses in addresses.json

**Usage:**
```bash
pnpm dlx tsx scripts/mint-initial-tokens.ts --network localhost
```

### `fund-vault-available.ts`

Deposit tokens into Vault for trading.

**Usage:**
```bash
pnpm dlx tsx scripts/fund-vault-available.ts --network localhost
```

**What it does:**
- Encrypts deposit amounts using fhevm-sdk
- Calls `transferEncryptedAndNotify` on tokens
- Credits Vault balances

## Trading Scripts

### `submit-buy-order.ts`

Submit an encrypted buy order to a market.

**Usage:**
```bash
pnpm dlx tsx scripts/submit-buy-order.ts --network localhost
```

**Example:**
```bash
# Buy BTC with 50k USDT at tick 2, no partial fills
AMOUNT=50000 TICK=2 PARTIAL=false pnpm dlx tsx scripts/submit-buy-order.ts --network localhost
```

### `submit-sell-order.ts`

Submit an encrypted sell order.

**Usage:**
```bash
pnpm dlx tsx scripts/submit-sell-order.ts --network localhost
```

**Example:**
```bash
# Sell 0.5 BTC at tick 1
AMOUNT=0.5 TICK=1 pnpm dlx tsx scripts/submit-sell-order.ts --network localhost
```

### `submit-cancel-order.ts`

Cancel an order before batch finalization.

**Usage:**
```bash
ORDER_ID=0 MARKET=0x... pnpm dlx tsx scripts/submit-cancel-order.ts --network localhost
```

**Parameters:**
- `ORDER_ID` - Order ID to cancel (from submit response)
- `MARKET` - Market contract address

### `finalize-batch.ts`

Finalize current batch and compute clearing price.

**Usage:**
```bash
pnpm dlx tsx scripts/finalize-batch.ts --network localhost
```

**What it does:**
1. Checks if batch has orders
2. Calls `finalizeBatch()` on market that computes encrypted clearing price (p*)
3. Freezes batch for settlement

**Output:**
```
Finalizing batch for market 0x...
Current batch ID: 1
Order count: 5
Phase: OPEN (0)

Finalization started...
Batch finalized! Tx: 0xdef456...
  Gas used: 2,456,789
  Clearing price: <encrypted>
```

### `settle-batch.ts`

Settle all orders at clearing price.

**Usage:**
```bash
pnpm dlx tsx scripts/settle-batch.ts --network localhost
```

**What it does:**
1. Verifies batch is FROZEN
2. Calls `settleBatch()` on market
3. Executes fills for all qualifying orders
4. Credits/debits Vault balances
5. Releases unfilled reserves
6. Opens next batch

**Output:**
```
Settling batch for market 0x...
Current batch ID: 1
Phase: FROZEN (1)

Settlement started...
Batch settled! Tx: 0xghi789...
  Gas used: 3,127,456
  Orders processed: 5
Next batch opened: 2
```

### `query-orders.ts`

View your orders in current batch.

**Usage:**
```bash
MARKET=0x... pnpm dlx tsx scripts/query-orders.ts --network localhost
```

**Output:**
```
Your orders in current batch:

Order #0
  Batch ID: 1
  Side: BUY (0)
  Tick: 1
  Partial fills: true
  Status: Open
  Settled: false
  Cancelled: false

Order #1
  Batch ID: 1
  Side: SELL (1)
  Tick: 2
  ...
```

## Next Steps

- Check [Architecture](./ARCHITECTURE.md) for system design

---

**Script away! 📜** Automate your encrypted exchange operations.
