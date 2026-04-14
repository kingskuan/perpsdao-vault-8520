// PerpsDAO Vault — index.js
// Decentralized Perpetual Strategy Vault API
// Powered by Pacifica (https://pacifica.fi) real-time data

import express from 'express';
import pacifica from './pacifica.js';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ─── In-memory storage ────────────────────────────────────────────────────────
const strategies = new Map();
const vaults     = new Map();
const proposals  = new Map();
const trades     = new Map();
let strategySeq  = 0;
let vaultSeq     = 0;
let proposalSeq  = 0;
let tradeSeq     = 0;

// ─── Helpers ──────────────────────────────────────────────────────────────────
const uid = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const randomPrice = (base, spread = 0.03) =>
  base * (1 + (Math.random() - 0.5) * spread);

const MOCK_PRICES = { 'BTC-USD': 65000, 'ETH-USD': 3500, 'SOL-USD': 150 };

// ─── Root ─────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    name: 'PerpsDAO Vault',
    version: '1.0.0',
    description: 'Decentralized Perpetual Strategy Vault',
    poweredBy: 'Pacifica — https://pacifica.fi',
    endpoints: [
      'GET /api/strategies',
      'POST /api/strategies',
      'GET /api/vaults',
      'POST /api/vaults',
      'POST /api/vaults/:id/deposit',
      'POST /api/vaults/:id/withdraw',
      'GET /api/governance',
      'POST /api/governance',
      'POST /api/governance/:id/vote',
      'POST /api/trades',
      'POST /api/trades/:id/close',
      'POST /api/bridge',
      'GET /api/markets',
      // Pacifica live data
      'GET /api/pacifica/markets',
      'GET /api/pacifica/funding/:symbol',
      'GET /api/pacifica/signal',
      'POST /api/pacifica/backtest',
    ],
  });
});

// ─── Markets (mock fallback) ──────────────────────────────────────────────────
app.get('/api/markets', (req, res) => {
  res.json({
    markets: Object.entries(MOCK_PRICES).map(([symbol, base]) => ({
      symbol,
      name: symbol.split('-')[0] === 'BTC' ? 'Bitcoin'
          : symbol.split('-')[0] === 'ETH' ? 'Ethereum' : 'Solana',
      price: randomPrice(base),
    })),
  });
});

// ─── Strategies ───────────────────────────────────────────────────────────────
app.get('/api/strategies', (req, res) => {
  res.json({ strategies: [...strategies.values()] });
});

app.post('/api/strategies', (req, res) => {
  const { name, creator, description, targetAPY, riskLevel } = req.body || {};
  if (!name || !creator) {
    return res.status(500).json({ error: 'Name and creator required' });
  }
  const id = ++strategySeq;
  const now = Date.now();
  const strategy = {
    id,
    nftId: uid('NFT'),
    name,
    description: description || '',
    creator,
    parameters: {},
    riskLevel: riskLevel || 'medium',
    performanceFee: 0.2,
    managementFee: 0.02,
    createdAt: now,
    updatedAt: now,
    totalPnL: 0,
    tradeCount: 0,
    active: true,
  };
  strategies.set(id, strategy);
  res.status(201).json({ strategy });
});

// ─── Vaults ───────────────────────────────────────────────────────────────────
app.get('/api/vaults', (req, res) => {
  res.json({ vaults: [...vaults.values()] });
});

app.post('/api/vaults', (req, res) => {
  const { name, strategyId, manager, maxCapacity, minDeposit } = req.body || {};
  if (!name || !strategyId || !manager) {
    return res.status(500).json({ error: 'Name, strategyId, and manager required' });
  }
  const id = ++vaultSeq;
  const now = Date.now();
  const vault = {
    id,
    name,
    strategyId: parseInt(strategyId) || strategyId,
    manager,
    totalAssets: 0,
    totalShares: 0,
    sharePrice: 1,
    createdAt: now,
    updatedAt: now,
    active: true,
    minDeposit: minDeposit || 100,
    maxCapacity: maxCapacity || 1000000,
  };
  vaults.set(id, vault);
  res.status(201).json({ vault });
});

// ─── Deposit ──────────────────────────────────────────────────────────────────
app.post('/api/vaults/:id/deposit', (req, res) => {
  const vault = vaults.get(parseInt(req.params.id));
  if (!vault) return res.status(404).json({ error: 'Not found' });

  const { amount } = req.body || {};
  const depositAmount = parseFloat(amount) || 0;
  const shares = depositAmount / vault.sharePrice;

  vault.totalAssets += depositAmount;
  vault.totalShares += shares;
  vault.updatedAt = Date.now();

  res.json({ shares, sharePrice: vault.sharePrice });
});

// ─── Withdraw ─────────────────────────────────────────────────────────────────
app.post('/api/vaults/:id/withdraw', (req, res) => {
  const vault = vaults.get(parseInt(req.params.id));
  if (!vault) return res.status(404).json({ error: 'Not found' });

  const { amount } = req.body || {};
  const withdrawAmount = parseFloat(amount) || 0;
  const sharesToBurn = withdrawAmount / vault.sharePrice;

  vault.totalAssets  = Math.max(0, vault.totalAssets - withdrawAmount);
  vault.totalShares  = Math.max(0, vault.totalShares - sharesToBurn);
  vault.updatedAt    = Date.now();

  // BUG FIX: was returning amount: null
  res.json({ amount: withdrawAmount, sharePrice: vault.sharePrice });
});

// ─── Governance ───────────────────────────────────────────────────────────────
app.get('/api/governance', (req, res) => {
  res.json({ proposals: [...proposals.values()] });
});

app.post('/api/governance', (req, res) => {
  const { title, description, proposer, votingPeriod } = req.body || {};
  if (!title || !proposer) {
    return res.status(500).json({ error: 'Title and proposer required' });
  }
  const id = ++proposalSeq;
  const now = Date.now();
  const days = parseInt(votingPeriod) || 7;
  const proposal = {
    id,
    title,
    description: description || '',
    proposer,
    parameters: {},
    votesFor: 0,
    votesAgainst: 0,
    voterCount: 0,
    status: 'active',
    createdAt: now,
    endTime: now + days * 24 * 60 * 60 * 1000,
  };
  proposals.set(id, proposal);
  res.status(201).json({ proposal });
});

app.post('/api/governance/:id/vote', (req, res) => {
  const proposal = proposals.get(parseInt(req.params.id));
  if (!proposal) return res.status(404).json({ error: 'Not found' });

  const { vote, weight } = req.body || {};
  const w = parseFloat(weight) || 1;

  // BUG FIX: was adding to wrong side
  if (vote === 'yes' || vote === 'for') {
    proposal.votesFor += w;
  } else {
    proposal.votesAgainst += w;
  }
  proposal.voterCount += 1;

  res.json({ votesFor: proposal.votesFor, votesAgainst: proposal.votesAgainst });
});

// ─── Trades ───────────────────────────────────────────────────────────────────
app.post('/api/trades', (req, res) => {
  const { market, side, size, leverage, collateral, vaultId, walletAddress } = req.body || {};

  const vault = vaults.get(parseInt(vaultId));
  if (!vault) return res.status(500).json({ error: 'Vault not found' });

  const basePrice = MOCK_PRICES[market] || 1000;
  const entryPrice = randomPrice(basePrice);
  const id = ++tradeSeq;
  const trade = {
    id,
    vaultId: vault.id,
    positionId: uid('POS'),
    market,
    side,
    size: parseFloat(size),
    leverage: parseFloat(leverage),
    entryPrice,
    status: 'open',
    createdAt: Date.now(),
  };
  trades.set(id, trade);

  // Update vault strategy trade count
  const strategy = strategies.get(vault.strategyId);
  if (strategy) {
    strategy.tradeCount += 1;
    strategy.updatedAt = Date.now();
  }

  res.status(201).json({ trade });
});

app.post('/api/trades/:id/close', (req, res) => {
  const trade = trades.get(parseInt(req.params.id));
  if (!trade) return res.status(404).json({ error: 'Not found' });
  if (trade.status === 'closed') return res.status(400).json({ error: 'Trade already closed' });

  const basePrice = MOCK_PRICES[trade.market] || 1000;
  const exitPrice = randomPrice(basePrice, 0.05);
  const direction = trade.side === 'long' ? 1 : -1;
  const pnl = direction * (exitPrice - trade.entryPrice) * trade.size * trade.leverage;

  trade.exitPrice = exitPrice;
  trade.pnl = pnl;
  trade.status = 'closed';
  trade.closedAt = Date.now();

  // Update vault share price
  const vault = vaults.get(trade.vaultId);
  if (vault && vault.totalShares > 0) {
    vault.totalAssets += pnl;
    vault.sharePrice = vault.totalAssets / vault.totalShares;
    vault.updatedAt = Date.now();
  }

  // Update strategy PnL
  const strategy = vault ? strategies.get(vault.strategyId) : null;
  if (strategy) {
    strategy.totalPnL += pnl;
    strategy.updatedAt = Date.now();
  }

  res.json({ trade });
});

// ─── Bridge ───────────────────────────────────────────────────────────────────
app.post('/api/bridge', (req, res) => {
  const { fromChain, toChain, token, amount, walletAddress } = req.body || {};
  if (!fromChain || !toChain || !token || !amount) {
    return res.status(400).json({ error: 'fromChain, toChain, token, and amount required' });
  }
  res.status(201).json({
    bridge: {
      id: uid('BRIDGE'),
      from: fromChain,
      to: toChain,
      token,
      amount: parseFloat(amount),
      status: 'pending',
      createdAt: Date.now(),
    },
  });
});

// ─── Pacifica live data routes ────────────────────────────────────────────────
app.use('/api/pacifica', pacifica);

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`PerpsDAO Vault running on port ${PORT}`);
  console.log(`Pacifica integration: /api/pacifica/*`);
});
