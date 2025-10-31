# System Architecture

## Overview

Sealed Exchange is a decentralized exchange (DEX) built on Ethereum with full privacy through Fully Homomorphic Encryption (FHE). The system consists of three main smart contract components and a React-based frontend.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend (React)                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Trading    │  │   Balance    │  │    Admin     │      │
│  │     UI       │  │   Manager    │  │    Panel     │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         │                 │                  │              │
│         └─────────────────┼──────────────────┘              │
│                           │                                 │
│                    fhevm-sdk (Encryption)                   │
└───────────────────────────┼─────────────────────────────────┘
                            │
                            │ Web3 / Ethers.js
                            │
┌───────────────────────────┼─────────────────────────────────┐
│                    Ethereum / fhEVM                         │
│                           │                                 │
│  ┌────────────────────────┼──────────────────────────────┐ │
│  │            Smart Contracts (Solidity)                  │ │
│  │                        │                               │ │
│  │  ┌──────────────────┐ │ ┌──────────────────┐         │ │
│  │  │ ConfidentialERC20│←┼→│      Vault       │         │ │
│  │  │   (Tokens)       │ │ │  (Custody/Ledger)│         │ │
│  │  └──────────────────┘ │ └────────┬─────────┘         │ │
│  │                       │          │                    │ │
│  │                       └──────────┼────────────┐       │ │
│  │                                  │            │       │ │
│  │                       ┌──────────▼─────────┐  │       │ │
│  │                       │    MarketPair      │  │       │ │
│  │                       │  (Order Matching)  │◄─┘       │ │
│  │                       └────────────────────┘          │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐ │
│  │              Zama fhEVM Infrastructure                │ │
│  │  • FHE Operations (add, sub, mul, select, eq, le)    │ │
│  │  • Ciphertext Storage (euint64, ebool)               │ │
│  │  • Access Control (FHE.allow, FHE.allowThis)         │ │
│  │  • Decryption Oracle                                 │ │
│  └──────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Component Overview

### 1. Smart Contracts

#### ConfidentialERC20
- **Purpose**: Privacy-preserving ERC20 token with encrypted balances
- **Key Features**:
  - Encrypted total supply (euint64)
  - Encrypted balances per holder
  - Encrypted allowances
  - Constant-time operations to avoid leaking through control flow
  - Auditor role for viewing balances
  - Direct transfer to Vault with notification

#### Vault
- **Purpose**: Central custody and ledger for all trading assets
- **Key Features**:
  - Per-trader, per-asset encrypted balances (available vs reserved)
  - Per-trader, per-asset, per-market, per-batch reserve buckets
  - Deposit/withdraw interface for users
  - Reserve/release/settle interface for approved markets
  - Asset registry and market approvals
  - Admin and auditor role management

#### MarketPair
- **Purpose**: Encrypted batch auction for a specific trading pair
- **Key Features**:
  - Walrasian equilibrium price discovery fully on-chain
  - Encrypted order sizes (euint64)
  - Public price ladder with encrypted index selection
  - Time-based batch windows
  - Support for BUY (quote) and SELL (base) orders
  - Partial fills and order cancellation
  - Encrypted matched volume and clearing price

### 2. Frontend Application

Located in `packages/ui`, the React-based UI provides:
- Wallet connection (MetaMask, WalletConnect)
- Trading interface for submitting encrypted orders
- Balance management (deposit/withdraw)
- Admin panel for token management
- Vault management for operators
- Event monitoring across all contracts
- Decryption UI for viewing encrypted values

### 3. fhevm-sdk Integration

The custom SDK (`packages/fhevm-sdk`) provides:
- Encrypted input creation (createEncryptedInput)
- User decryption (userDecrypt with EIP-712 signatures)
- Automatic relayer selection (local mock vs hosted Sepolia relayer)
- React hooks for encryption/decryption flows

## Data Flow

### Deposit Flow
```
User → ConfidentialERC20.transferEncryptedAndNotify()
    ├─→ Token: encrypt amount (SDK)
    ├─→ Token: move balance holder → vault
    └─→ Vault: onDepositFromToken() callback
        └─→ Vault: credit user's available balance
```

### Trading Flow
```
User → MarketPair.submitBuy() / submitSell()
    ├─→ Market: encrypt order qty (SDK)
    ├─→ Vault: reserveFor() - move available → reserved
    └─→ Market: store order in current batch

Admin → MarketPair.finalizeBatch()
    ├─→ Market: accumulate demand/supply per tick
    ├─→ Market: find clearing price (encrypted p*)
    └─→ Market: emit ClearingChosen event

Admin → MarketPair.settleBatch()
    ├─→ Market: iterate orders at p*
    ├─→ Vault: settleBuy() / settleSell()
    │     ├─→ consume reserved quote/base
    │     └─→ credit base/quote to available
    └─→ Market: release unfilled reserves
```

### Withdraw Flow
```
User → Vault.withdraw()
    ├─→ Vault: encrypt amount (SDK)
    ├─→ Vault: check available balance (FHE.le)
    ├─→ Vault: debit available (constant-time)
    └─→ Token: transfer to user
```

## Security Model

### Encryption Layer
- All sensitive amounts (balances, orders, fills) are encrypted as euint64
- Operations use FHE arithmetic (add, sub, mul, div, select)
- Constant-time patterns with `FHE.select()` prevent timing leaks
- Access control via `FHE.allow()` and `FHE.allowThis()`

### Role-Based Access
- **Owner/Admin**: Deploy contracts, mint tokens, manage assets/markets
- **Auditor**: View encrypted balances for compliance
- **Trader**: Submit orders, deposit, withdraw
- **Market**: Reserve/release/settle on behalf of traders

### Reentrancy Protection
- Vault and MarketPair use custom ReentrancyGuard
- All state-changing external calls are protected

## Network Architecture

### Local Development
- Hardhat node (chainId 31337)
- Mock fhEVM environment
- Instant block mining
- Local SDK with mock encryption

### Sepolia Testnet
- Public Ethereum testnet (chainId 11155111)
- Hosted Zama relayer (relayer.testnet.zama.cloud)
- Real FHE operations
- Block time ~12-15 seconds

### Production (Future)
- Mainnet with fhEVM support
- Decentralized relayer network
- Enhanced security audits

## Scalability Considerations

### Current Limitations
- Batch size limited (MAX_ORDERS typically 4-16)
- Tick ladder size limited by stack depth (MAX_TICKS typically ≤16)
- FHE operations are more expensive than plaintext

### Optimization Strategies
- Struct bundling to reduce stack pressure
- Efficient loop bounds and early exits
- Minimal ciphertext storage
- Batch processing amortizes overhead

## Extensibility Points

### Adding New Markets
1. Deploy new MarketPair with specific base/quote assets
2. Register in Vault via `setMarketApproved()`
3. Configure price ladder for the pair
4. Update frontend with market address

### Adding New Assets
1. Deploy new ConfidentialERC20 token
2. Register in Vault via `registerAsset()`
3. Set numeraire flag if quote currency
4. Update frontend with token address

### Custom Order Types
- Extend MarketPair with new order structures
- Add fields to Order struct
- Implement custom matching logic in finalizeBatch

## Technology Stack

- **Smart Contracts**: Solidity 0.8.24+
- **FHE Library**: @fhevm/solidity ^0.8.0
- **Development**: Hardhat 2.26+, TypeScript
- **Testing**: Mocha, Chai, Hardhat Network Helpers
- **Frontend**: React 18, Vite, TanStack Router
- **Web3**: Ethers.js v6, Wagmi
- **Styling**: Tailwind CSS, Shadcn UI

## Next Steps

- Read [Smart Contracts](./CONTRACTS.md) for detailed API documentation
