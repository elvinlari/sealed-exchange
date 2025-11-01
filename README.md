# Sealed Exchange

[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)
[![Hardhat](https://img.shields.io/badge/hardhat-2.22.0-yellow.svg)](https://hardhat.org)
[![fhEVM](https://img.shields.io/badge/fhEVM-Zama-purple.svg)](https://docs.zama.ai/fhevm)

> A privacy-preserving decentralized exchange powered by Fully Homomorphic Encryption (FHE) on Ethereum.

Sealed Exchange is a next-generation DEX that enables **fully confidential trading** where order amounts, balances, and trade execution details remain encrypted on-chain. Built with [Zama's fhEVM](https://docs.zama.ai/fhevm), it uses Fully Homomorphic Encryption to perform computations directly on encrypted data without ever revealing sensitive information.

## 🌟 Why Sealed Exchange?

Traditional DEXs expose all trading activity on-chain, creating opportunities for front-running, MEV extraction, and privacy violations. Sealed Exchange solves this by:

- **🔒 Encrypted Order Books**: Order quantities and prices remain confidential
- **🎯 Fair Price Discovery**: Batch auctions with Walrasian equilibrium matching prevent front-running
- **🔐 Private Balances**: All token balances are encrypted using FHE
- **⚡ On-Chain Computation**: Settlement happens entirely on-chain without trusted third parties
- **🏦 Institutional-Grade Security**: Vault-based architecture separates custody from trading logic

## 💎 Beyond Centralized Exchanges

### The Problem with Centralized Exchanges

Centralized exchanges (CEXs) have dominated crypto trading, but they come with critical flaws:

- **❌ Custody Risk**: You don't control your assets ("not your keys, not your coins")
- **❌ Single Point of Failure**: Exchange hacks, insolvency, or regulatory actions can freeze or lose your funds
- **❌ Privacy Invasion**: CEXs collect extensive KYC data and track all your trading activity
- **❌ Regulatory Vulnerability**: Subject to government seizures, account freezes, and asset restrictions
- **❌ Limited Transparency**: Opaque order books and execution often favor institutional traders
- **❌ Counterparty Risk**: Must trust the exchange to honor trades and withdrawals

### The Sealed Exchange Advantage

Sealed Exchange combines the **privacy benefits of centralized exchanges** with the **security and transparency of decentralized systems**:

| Feature | CEX | Traditional DEX | **Sealed Exchange** |
|---------|-----|-----------------|---------------------|
| Self-Custody | ❌ | ✅ | ✅ |
| Private Balances | ✅ | ❌ | ✅ |
| Private Order Sizes | ✅ | ❌ | ✅ |
| No Front-Running | ❌ | ❌ | ✅ |
| On-Chain Settlement | ❌ | ✅ | ✅ |
| No KYC Required | ❌ | ✅ | ✅ |
| Censorship Resistant | ❌ | ✅ | ✅ |
| Trustless Execution | ❌ | ✅ | ✅ |

### 🏛️ Unlocking Real-World Asset Tokenization

The tokenization of real-world assets (RWAs)—stocks, bonds, real estate, commodities, art—represents a **multi-trillion dollar opportunity**. However, privacy remains a critical barrier to institutional adoption.

#### Why Privacy Matters for RWA Trading

**Institutional Investors Need Confidentiality**:
- **Strategic Positions**: Large institutions can't reveal their holdings without moving markets
- **Competitive Advantage**: Trading strategies must remain confidential
- **Regulatory Compliance**: Privacy regulations (GDPR, financial privacy laws) require data protection
- **Client Protection**: Asset managers have fiduciary duties to protect client information

**Current Solutions Fall Short**:
- **CEXs**: Centralized databases vulnerable to hacks, leaks, and regulatory seizures
- **Traditional DEXs**: Completely transparent on-chain, unsuitable for institutional trading
- **Private Chains**: Sacrifice decentralization and composability

#### Sealed Exchange: The Bridge to RWA Adoption

**Privacy-Preserving Trading**:
- **Encrypted Holdings**: Institutions can hold tokenized assets without revealing positions
- **Confidential Transactions**: Trading volumes remain private, preventing market manipulation
- **Selective Disclosure**: Compliance with regulations through controlled decryption for auditors

**Institutional-Grade Infrastructure**:
- **Vault Architecture**: Professional custody model familiar to traditional finance
- **Batch Auctions**: Fair price discovery prevents manipulation and reduces slippage
- **Role-Based Access**: Admin, auditor, and trader roles enable regulatory compliance
- **On-Chain Proof**: Cryptographic verification without revealing sensitive data

**Real-World Use Cases**:

1. **Tokenized Securities**: Trade stocks, bonds, and derivatives with full privacy
2. **Real Estate Fractions**: Buy and sell property shares without exposing portfolio positions
3. **Art & Collectibles**: Confidential trading of high-value tokenized assets
4. **Commodities**: Private trading of gold, oil, and other commodity tokens
5. **Carbon Credits**: Environmental asset trading with commercial privacy
6. **Private Equity**: Secondary market for PE tokens without information leakage

**Regulatory Compliance**:
- **Auditor Role**: Authorized parties can decrypt specific data for compliance checks
- **Privacy + Transparency**: Maintain trader privacy while enabling regulatory oversight
- **GDPR Compatible**: Encrypted data helps meet data protection requirements
- **AML/KYC Integration**: Can be layered on top without compromising on-chain privacy

#### The Future of Finance

Sealed Exchange represents the **convergence of three major trends**:

1. **Tokenization**: Bringing real-world assets on-chain
2. **DeFi**: Self-custodial, trustless financial infrastructure  
3. **Privacy Technology**: Fully homomorphic encryption enabling confidential computation

This combination creates the **first truly viable platform** for institutional participation in tokenized asset markets, potentially unlocking **trillions in liquidity** while protecting the privacy and security that institutions require.

## 🚀 Quick Start

### Prerequisites

- **Node.js** ≥ 20
- **pnpm** ≥ 9.0.0 (recommended) or npm
- **Git**
- **MetaMask** or Web3 wallet

### Installation

```bash
# Clone the repository
git clone https://github.com/elvinlari/sealed-exchange.git
cd sealed-exchange

# Install dependencies
pnpm install

# Build all packages
pnpm build
```

### Configuration

```bash
# Set up your mnemonic
pnpm hardhat vars set MNEMONIC
# For local dev, use: "test test test test test test test test test test test junk"

# Set Infura API key for Sepolia testnet
pnpm hardhat vars set INFURA_API_KEY

# Optional: Etherscan API key for contract verification
pnpm hardhat vars set ETHERSCAN_API_KEY
```

### Run Tests

```bash
# Run all tests
pnpm test

# Run with coverage
pnpm test:coverage

# Run specific test file
pnpm hardhat test test/MarketPair.test.ts
```

### Local Development

```bash
# Terminal 1: Start local fhEVM node
pnpm hardhat node

# Terminal 2: Deploy contracts
pnpm deploy:localhost

# Terminal 3: Start the UI
pnpm dev
```

Visit `http://localhost:3000` to access the trading interface.

### Deploy to Sepolia

```bash
# Deploy all contracts
pnpm deploy:sepolia

# Verify contracts
pnpm hardhat verify --network sepolia <CONTRACT_ADDRESS>
```

## 📁 Project Structure

```
sealed-exchange/
├── contracts/                 # Smart contracts (Solidity)
│   ├── ConfidentialERC20.sol # FHE-enabled ERC20 token
│   ├── Vault.sol             # Central custody & ledger
│   └── MarketPair.sol        # Batch auction market
├── deploy/                    # Deployment scripts
├── test/                      # Contract tests
├── scripts/                   # Management utilities
├── packages/
│   ├── fhevm-sdk/            # FHE SDK for frontend
│   └── ui/                   # React trading interface
├── docs/                      # Documentation
│   ├── ARCHITECTURE.md       # System architecture
│   ├── CONTRACTS.md          # Contract details
│   ├── QUICK_START.md        # Quick start guide
│   └── SCRIPTS.md            # Scripts reference
└── hardhat.config.ts         # Hardhat configuration
```

## 🎯 Core Features

### Confidential Trading
- **Encrypted Orders**: Submit buy/sell orders with encrypted amounts
- **Batch Auctions**: Orders accumulate in time-based batches
- **Fair Matching**: Walrasian equilibrium ensures optimal price discovery
- **Privacy-Preserving**: All sensitive data remains encrypted on-chain

### Vault System
- **Secure Custody**: Centralized vault manages all token deposits
- **Segregated Balances**: Available vs reserved balances per trader
- **Batch-Based Reserves**: Orders reserve funds per market per batch
- **Atomic Settlement**: Matched trades settle atomically after finalization

### Role-Based Access
- **Admin**: Deploy markets, manage system parameters
- **Auditor**: Decrypt balances for compliance (with proper authorization)
- **Trader**: Submit orders, deposit/withdraw funds

### Multi-Asset Support
- Trade any combination of confidential ERC20 tokens
- Support for multiple market pairs simultaneously
- Configurable price ladders (tick grids) per market

## 🔧 Available Scripts

| Command | Description |
|---------|-------------|
| `pnpm build` | Compile contracts and build all packages |
| `pnpm compile` | Compile smart contracts only |
| `pnpm test` | Run all tests |
| `pnpm test:coverage` | Generate test coverage report |
| `pnpm deploy:localhost` | Deploy to local node |
| `pnpm deploy:sepolia` | Deploy to Sepolia testnet |
| `pnpm lint` | Run linters |
| `pnpm clean` | Clean build artifacts |

## 📚 Documentation

### Getting Started
- **[Quick Start Guide](./docs/QUICK_START.md)** - Get running in minutes
- **[Architecture Overview](./docs/ARCHITECTURE.md)** - System design and components
- **[Smart Contracts](./docs/CONTRACTS.md)** - Detailed contract documentation
- **[Price Discovery](./docs/PRICE_DISCOVERY.md)** - How the clearing price is computed
- **[Scripts Reference](./docs/SCRIPTS.md)** - Management scripts and utilities

### External Resources
- **[Zama fhEVM Docs](https://docs.zama.ai/fhevm)** - Fully Homomorphic Encryption documentation
- **[Hardhat Documentation](https://hardhat.org/docs)** - Development environment guide
- **[Ethers.js v6](https://docs.ethers.org/v6/)** - Ethereum library reference

## �️ Technology Stack

- **Blockchain**: Ethereum (Sepolia testnet), fhEVM-compatible chains
- **Smart Contracts**: Solidity 0.8.24
- **Encryption**: Zama fhEVM (Fully Homomorphic Encryption)
- **Development**: Hardhat, TypeScript
- **Frontend**: React 19, Vite, TailwindCSS
- **State Management**: Zustand
- **Web3**: Ethers.js v6

## 🔐 Security Considerations

- **Encrypted State**: All sensitive data stored as encrypted ciphertexts (euint64, ebool)
- **Access Control**: FHE.allow() grants selective decryption permissions
- **Reentrancy Guards**: All critical functions protected
- **Role-Based Security**: Admin, auditor, and trader roles with separate privileges
- **Audited Contracts**: Built on Zama's audited fhEVM infrastructure

⚠️ **Note**: This project is in active development. Do not use in production without a thorough security audit.

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

Please ensure:
- All tests pass (`pnpm test`)
- Code follows the existing style (`pnpm lint`)
- Commits are descriptive and well-structured


## 🆘 Support & Community

- **Issues**: [GitHub Issues](https://github.com/elvinlari/sealed-exchange/issues)
- **Discussions**: [GitHub Discussions](https://github.com/elvinlari/sealed-exchange/discussions)
- **Zama Discord**: Join the [Zama community](https://discord.gg/zama) for FHE questions

## 🎯 Roadmap

- [x] Core confidential ERC20 implementation
- [x] Vault custody system
- [x] Batch auction market matching
- [x] React trading interface
- [x] Sepolia testnet deployment
- [x] Multiple market pairs UI
- [ ] Optimized gas consumption
- [ ] Advanced order types
- [ ] Mainnet deployment
- [ ] Mobile app

## 👥 Team

Built by [Elvin Lari](https://linktr.ee/elvinlari) with support from the [Zama](https://zama.ai) ecosystem.

## 🙏 Acknowledgments

- **[Zama](https://zama.ai)** for pioneering Fully Homomorphic Encryption technology
- **[fhEVM](https://docs.zama.ai/fhevm)** team for the encrypted computation infrastructure
- The Ethereum and Web3 community for continuous innovation

---

**⚡ Start trading with privacy. Start with Sealed Exchange.**
