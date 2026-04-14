# PerpsDAO Vault — 去中心化永续策略金库

## Description

PerpsDAO Vault is a decentralized perpetuals strategy vault that enables users to deposit collateral and automatically execute optimized trading strategies across multiple perpetual futures protocols. Built with Solidity smart contracts and powered by the Pacifica API for market data, it integrates Rhinofi bridging for cross-chain liquidity management and provides real-time monitoring through The Graph subgraphs.

The vault abstracts complexity from users while maintaining full transparency and on-chain composability, enabling efficient capital deployment in perpetual futures markets.

## Features

- **Automated Strategy Execution**: Smart contract-based perpetuals trading strategies with configurable parameters
- **Multi-Protocol Support**: Integration with leading perpetual futures platforms via standardized interfaces
- **Pacifica API Integration**: Real-time market data feeds for informed trading decisions
- **Rhinofi Bridging**: Seamless cross-chain token transfers and liquidity optimization
- **Subgraph Indexing**: The Graph integration for efficient on-chain data querying and analytics
- **User Dashboard**: React-based interface for deposits, withdrawals, and performance tracking
- **Risk Management**: Built-in position sizing, leverage controls, and emergency pause mechanisms
- **Transparent Accounting**: Real-time NAV calculation and fee transparency

## Project Structure

```
perps-dao-vault/
├── contracts/
│   ├── PerpsVault.sol          # Main vault contract
│   ├── StrategyExecutor.sol    # Strategy execution logic
│   ├── RiskManager.sol         # Position and leverage controls
│   └── lib/
│       ├── PacificaOracle.sol  # Pacifica API integration
│       ├── RhinofiAdapter.sol  # Rhinofi bridge adapter
│       └── MathLib.sol         # Utility calculations
├── subgraph/
│   ├── schema.graphql          # The Graph schema
│   ├── subgraph.yaml           # Subgraph manifest
│   └── src/
│       └── mapping.ts          # Event indexing logic
├── frontend/
│   ├── src/
│   │   ├── components/         # React UI components
│   │   ├── pages/              # Main views (Dashboard, Deposit, Withdraw)
│   │   ├── hooks/              # Custom React hooks
│   │   ├── services/           # API and contract interactions
│   │   └── App.tsx             # Root component
│   ├── package.json
│   └── vite.config.ts
├── test/
│   ├── PerpsVault.test.ts
│   ├── StrategyExecutor.test.ts
│   └── RiskManager.test.ts
├── .env.example
├── hardhat.config.ts
└── README.md
```

## Setup

### Prerequisites

- Node.js >= 16
- Hardhat
- Git

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/perpdao/vault.git
   cd vault
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment**
   ```bash
   cp .env.example .env
   ```
   
   Fill in the following variables:
   ```
