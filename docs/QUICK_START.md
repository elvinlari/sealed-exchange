# Quick Start Guide

Get Sealed Exchange running locally in under 10 minutes.

## Prerequisites

Ensure you have:
- **Node.js** ≥ 20
- **pnpm** (recommended) or npm
- **Git**
- **MetaMask** or another Web3 wallet

## Installation

### 1. Clone and Install

```bash
# Clone the repository
git clone https://github.com/elvinlari/sealed-exchange.git
cd sealed-exchange

# Install dependencies
pnpm install

# Build the project (compiles contracts and builds packages)
pnpm build
```

### 2. Configure Environment

```bash
# Set up Hardhat variables
pnpm hardhat vars set MNEMONIC
# Enter your 12/24-word mnemonic when prompted
# For local dev, use: "test test test test test test test test test test test junk"

# Set Infura API key (for Sepolia)
pnpm hardhat vars set INFURA_API_KEY
# Get free key at https://infura.io

# Optional: Etherscan API key for verification
pnpm hardhat vars set ETHERSCAN_API_KEY
```

### 3. Run Tests

```bash
pnpm test
```

**Expected output:**
```
  ConfidentialERC20
    ✔ deploys with correct metadata and owner
    ✔ only owner can grant/revoke auditor role
    ...

  12 passing (272ms)
```

## Local Development

### Start Local Chain

Terminal 1:
```bash
pnpm dev:chain
```

This starts a local Hardhat node on `http://127.0.0.1:8545` with:
- 10 funded accounts from your MNEMONIC
- Mock fhEVM environment
- Instant block mining

### Deploy Contracts

Terminal 2:
```bash
pnpm deploy:localhost
```

**What gets deployed:**
1. Vault
2. ConfidentialERC20 tokens (cBTC, cETH, cUSDT, cXAU)
3. MarketPair contracts (BTC/USDT, ETH/USDT, XAU/USDT)

Deployment addresses are saved to:
- `deployments/localhost/`
- `scripts/addresses.json`

### Configure UI Environment

```bash
cd packages/ui
cp .env.example .env
```

Edit `.env` with your deployed addresses (auto-updated by deploy scripts):
```bash
VITE_VAULT_ADDRESS=0x...
VITE_TOKEN_CUSDT_ADDRESS=0x...
VITE_TOKEN_CBTC_ADDRESS=0x...
# ... etc
VITE_RPC_URL=http://127.0.0.1:8545
```

### Start Frontend

Terminal 3:
```bash
pnpm dev
```

**UI available at:** `http://localhost:3000`

### Initialize System

Terminal 2 (with local chain running and default hardhat wallets):
```bash
# Mint initial tokens to deployer
pnpm dlx tsx scripts/mint-initial-tokens.ts --network localhost

# Register assets in Vault
pnpm dlx tsx scripts/register-market-assets.ts --network localhost

# Fund Vault with liquidity (optional)
pnpm dlx tsx scripts/fund-vault-available.ts --network localhost
```

## First Trade

### Using the UI

1. **Connect Wallet**
   - Open http://localhost:3000
   - Click "Connect Wallet"
   - Select MetaMask
   - Choose localhost hardhat network (Chain ID 31337)

2. **Mint Tokens (admin)**
   - Navigate to "Tokens" tab
   - Select token contract (e.g., cUSDT)
   - Input your wallet address
   - Enter amount
   - Click "Mint" → Confirm in MetaMask

3. **Register Assets and Approve Markets (admin)**
   - Navigate to "Vault" tab
   - Go to Assets
   - Choose the token
   - Click Fetch Details
   - Click "Register Asset" → Confirm in MetaMask
   - Go to Markets
   - Select the market
   - Click "Approve Market" → Confirm in MetaMask

4. **Deposit Tokens to Vault**
   - Navigate to "Balances" tab
   - Select Vault
   - Select token (e.g., cUSDT)
   - Click Deposit and Enter amount
   - Click "Deposit" → Confirm in MetaMask

5. **Submit Order**
   - Navigate to "Trade" tab
   - Select market (e.g., BTC/USDT)
   - Choose BUY or SELL
   - Select price tick from the Price Ladder
   - Enter quantity
   - Click "Submit Order" → Confirm in MetaMask

6. **Finalize Batch**
   - Wait for batch window to close 
   - Click "Finalize Batch" (on Batch Controls Panel)
   - Click "Settle Batch" after finalization

7. **Check Balance**
   - Navigate to "Balances" tab
   - Click "Decrypt" to view your encrypted balances

### Using Scripts (on local chain with default hardhat wallets)

```bash
# Submit a buy order
pnpm dlx tsx scripts/submit-buy-order.ts --network localhost

# Submit a sell order
pnpm dlx tsx scripts/submit-sell-order.ts --network localhost

# Finalize batch
pnpm dlx tsx scripts/finalize-batch.ts --network localhost

# Settle batch
pnpm dlx tsx scripts/settle-batch.ts --network localhost

# Check balances
pnpm dlx tsx scripts/log-vault-balances.ts --network localhost
```

## Sepolia Testnet

### Get Testnet ETH

1. Get Sepolia ETH from faucet:
   - https://sepoliafaucet.com
   - https://www.alchemy.com/faucets/ethereum-sepolia

2. Ensure your first account from MNEMONIC has ≥0.5 ETH

### Deploy to Sepolia

```bash
pnpm deploy:sepolia
```

**Note:** Deployment takes 5-10 minutes due to block times and verifications.

### Update UI for Sepolia

```bash
cd packages/ui
nano .env
```

Update:
```bash
VITE_RPC_URL=https://sepolia.infura.io/v3/YOUR_INFURA_KEY
# Update contract addresses from deployments/sepolia/
```

### Test on Sepolia

```bash
pnpm test:sepolia
```

**Note:** Tests run slower on Sepolia (~5 minutes) and skip heavy operations to avoid gas/rate limits.

## Common Commands

| Command | Description |
|---------|-------------|
| `pnpm build` | Build entire project (contracts + packages + UI) |
| `pnpm build:contracts` | Compile contracts only |
| `pnpm build:packages` | Build SDK package only |
| `pnpm build:ui` | Build UI only |
| `pnpm test` | Run all tests (contracts + SDK) |
| `pnpm test:contracts` | Run contract tests only |
| `pnpm test:packages` | Run SDK tests only |
| `pnpm test:sepolia` | Run tests on Sepolia |
| `pnpm dev` | Start UI dev server |
| `pnpm dev:chain` | Start local blockchain node |
| `pnpm deploy:localhost` | Deploy to local node |
| `pnpm deploy:sepolia` | Deploy to Sepolia |
| `pnpm lint` | Run all linters |
| `pnpm lint:fix` | Fix linting issues |
| `pnpm clean` | Clean all build artifacts |

## Troubleshooting

### "Insufficient funds" error
- **Local:** Ensure you're using a funded account from Hardhat
- **Sepolia:** Get testnet ETH from faucets

### "Nonce too high" in MetaMask
- Reset MetaMask account: Settings → Advanced → Clear activity tab data

### Contracts won't compile
- Ensure Solidity version 0.8.24+ is supported
- Check `hardhat.config.ts` for correct compiler version
- Run `pnpm clean` then `pnpm deploy:localhost`

### Fix Wrong Network"
- Switch MetaMask to the correct network:
  - Local: Chain ID 31337
  - Sepolia: Chain ID 11155111

### Encrypted values show "0x..."
- This is expected! Encrypted values are ciphertexts
- Use "Decrypt" button to view plaintext (requires signing)

## Next Steps

- **Architecture:** Read [Architecture Guide](./ARCHITECTURE.md) to understand the system
- **Contracts:** See [Smart Contracts](./CONTRACTS.md) for detailed API docs

## Getting Help

- **Issues:** https://github.com/elvinlari/sealed-exchange/issues
- **Zama Docs:** https://docs.zama.ai
- **Discord:** Join Zama community for FHE questions

---

**Ready to trade privately? 🔒** Your encrypted orders are waiting!
