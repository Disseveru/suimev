# ⚡ EVM Zero-Capital MEV Liquidation Engine (Monad & Sei v2)

High-performance, zero-capital MEV liquidation engine engineered for parallel EVM chains (**Monad** & **Sei Network v2**).

---

## 🏛️ Architecture Overview

Unlike Sui's native Programmable Transaction Blocks (PTB), EVM requires an on-chain smart contract to orchestrate atomic flash loans and liquidations.

```text
[Searcher Daemon]
       │
       ▼ (eth_call simulation & PGA tip calculation)
[FlashLiquidator.sol]
       │
       ├── 1. Flash Loan Borrow (Balancer Vault 0% / Aave v3)
       ├── 2. Liquidation Call (Yei Finance / Aave v3 / Curvance)
       ├── 3. Atomic DEX Swap (DragonSwap / Uniswap v3 / Ambient)
       ├── 4. Repay Flash Loan
       └── 5. Sweep 100% Net MEV Profit to Operator Wallet
```

---

## 🚀 Getting Started

### 1. Check Live Network Status (Sei v2 EVM / Monad)

```bash
npm run status
```

### 2. Run Zero-Capital Pre-Flight Simulation

```bash
npm run simulate
```

### 3. Run Automated Test Suite

```bash
npm test
```

---

## 🛡️ Smart Contract (`contracts/FlashLiquidator.sol`)

* **Atomic Revert Protection:** Enforces `require(remainingProfit >= params.minProfit)`. If DEX slippage or fees make the trade unprofitable, the entire call reverts, guaranteeing zero lost capital.
* **Dual Flash Loan Support:** Native integration for Balancer Vault (0% fee) and Aave v3 simple flash loans.
* **Emergency Sweep:** Admin-controlled safety functions.
