// PerpsDAO Vault — index.js
import express from 'express';
import pacifica from './pacifica.js';

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Serve frontend
app.use(express.static('public'));

// ─── Storage ──────────────────────────────────────────────────────────────────
const strategies = new Map(), vaults = new Map(), proposals = new Map(), trades = new Map();
let sSeq = 0, vSeq = 0, pSeq = 0, tSeq = 0;
const uid = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
const rndPrice = (base, spread = 0.03) => base * (1 + (Math.random() - 0.5) * spread);
const PRICES = { 'BTC-USD': 65000, 'ETH-USD': 3500, 'SOL-USD': 150 };

// ─── Root API info ─────────────────────────────────────────────────────────────
app.get('/api', (req, res) => res.json({
  name: 'PerpsDAO Vault', version: '1.0.0',
  description: 'Decentralized Perpetual Strategy Vault',
  poweredBy: 'Pacifica — https://pacifica.fi',
}));

// ─── Markets ──────────────────────────────────────────────────────────────────
app.get('/api/markets', (req, res) => res.json({
  markets: Object.entries(PRICES).map(([sym, base]) => ({
    symbol: sym,
    name: sym.startsWith('BTC') ? 'Bitcoin' : sym.startsWith('ETH') ? 'Ethereum' : 'Solana',
    price: rndPrice(base),
  })),
}));

// ─── Strategies ───────────────────────────────────────────────────────────────
app.get('/api/strategies', (req, res) => res.json({ strategies: [...strategies.values()] }));

app.post('/api/strategies', (req, res) => {
  const { name, creator, description, targetAPY, riskLevel } = req.body || {};
  if (!name || !creator) return res.status(500).json({ error: 'Name and creator required' });
  const id = ++sSeq, now = Date.now();
  const s = { id, nftId: uid('NFT'), name, description: description||'', creator,
    parameters:{}, riskLevel: riskLevel||'medium', performanceFee:0.2, managementFee:0.02,
    createdAt:now, updatedAt:now, totalPnL:0, tradeCount:0, active:true };
  strategies.set(id, s);
  res.status(201).json({ strategy: s });
});

// ─── Vaults ───────────────────────────────────────────────────────────────────
app.get('/api/vaults', (req, res) => res.json({ vaults: [...vaults.values()] }));

app.post('/api/vaults', (req, res) => {
  const { name, strategyId, manager, maxCapacity, minDeposit } = req.body || {};
  if (!name || !strategyId || !manager) return res.status(500).json({ error: 'Name, strategyId, and manager required' });
  const id = ++vSeq, now = Date.now();
  const v = { id, name, strategyId: parseInt(strategyId)||strategyId, manager,
    totalAssets:0, totalShares:0, sharePrice:1, createdAt:now, updatedAt:now,
    active:true, minDeposit: minDeposit||100, maxCapacity: maxCapacity||1000000 };
  vaults.set(id, v);
  res.status(201).json({ vault: v });
});

app.post('/api/vaults/:id/deposit', (req, res) => {
  const v = vaults.get(parseInt(req.params.id));
  if (!v) return res.status(404).json({ error: 'Not found' });
  const amt = parseFloat(req.body?.amount)||0;
  const shares = amt / v.sharePrice;
  v.totalAssets += amt; v.totalShares += shares; v.updatedAt = Date.now();
  res.json({ shares, sharePrice: v.sharePrice });
});

app.post('/api/vaults/:id/withdraw', (req, res) => {
  const v = vaults.get(parseInt(req.params.id));
  if (!v) return res.status(404).json({ error: 'Not found' });
  const amt = parseFloat(req.body?.amount)||0;
  v.totalAssets = Math.max(0, v.totalAssets - amt);
  v.totalShares = Math.max(0, v.totalShares - amt/v.sharePrice);
  v.updatedAt = Date.now();
  res.json({ amount: amt, sharePrice: v.sharePrice });
});

// ─── Governance ───────────────────────────────────────────────────────────────
app.get('/api/governance', (req, res) => res.json({ proposals: [...proposals.values()] }));

app.post('/api/governance', (req, res) => {
  const { title, description, proposer, votingPeriod } = req.body || {};
  if (!title || !proposer) return res.status(500).json({ error: 'Title and proposer required' });
  const id = ++pSeq, now = Date.now();
  const p = { id, title, description: description||'', proposer, parameters:{},
    votesFor:0, votesAgainst:0, voterCount:0, status:'active',
    createdAt:now, endTime: now + (parseInt(votingPeriod)||7)*86400000 };
  proposals.set(id, p);
  res.status(201).json({ proposal: p });
});

app.post('/api/governance/:id/vote', (req, res) => {
  const p = proposals.get(parseInt(req.params.id));
  if (!p) return res.status(404).json({ error: 'Not found' });
  const { vote, weight } = req.body || {};
  const w = parseFloat(weight)||1;
  if (vote === 'yes' || vote === 'for') p.votesFor += w; else p.votesAgainst += w;
  p.voterCount += 1;
  res.json({ votesFor: p.votesFor, votesAgainst: p.votesAgainst });
});

// ─── Trades ───────────────────────────────────────────────────────────────────
app.post('/api/trades', (req, res) => {
  const { market, side, size, leverage, vaultId } = req.body || {};
  const v = vaults.get(parseInt(vaultId));
  if (!v) return res.status(500).json({ error: 'Vault not found' });
  const id = ++tSeq;
  const trade = { id, vaultId:v.id, positionId:uid('POS'), market, side,
    size:parseFloat(size), leverage:parseFloat(leverage),
    entryPrice:rndPrice(PRICES[market]||1000), status:'open', createdAt:Date.now() };
  trades.set(id, trade);
  const s = strategies.get(v.strategyId);
  if (s) { s.tradeCount++; s.updatedAt = Date.now(); }
  res.status(201).json({ trade });
});

app.post('/api/trades/:id/close', (req, res) => {
  const t = trades.get(parseInt(req.params.id));
  if (!t) return res.status(404).json({ error: 'Not found' });
  if (t.status === 'closed') return res.status(400).json({ error: 'Already closed' });
  const exit = rndPrice(PRICES[t.market]||1000, 0.05);
  const pnl  = (t.side==='long'?1:-1) * (exit - t.entryPrice) * t.size * t.leverage;
  t.exitPrice=exit; t.pnl=pnl; t.status='closed'; t.closedAt=Date.now();
  const v = vaults.get(t.vaultId);
  if (v && v.totalShares > 0) { v.totalAssets+=pnl; v.sharePrice=v.totalAssets/v.totalShares; v.updatedAt=Date.now(); }
  const s = v ? strategies.get(v.strategyId) : null;
  if (s) { s.totalPnL+=pnl; s.updatedAt=Date.now(); }
  res.json({ trade: t });
});

// ─── Bridge ───────────────────────────────────────────────────────────────────
app.post('/api/bridge', (req, res) => {
  const { fromChain, toChain, token, amount } = req.body || {};
  if (!fromChain||!toChain||!token||!amount) return res.status(400).json({ error: 'Missing fields' });
  res.status(201).json({ bridge:{ id:uid('BRIDGE'), from:fromChain, to:toChain, token, amount:parseFloat(amount), status:'pending', createdAt:Date.now() }});
});

// ─── Pacifica ─────────────────────────────────────────────────────────────────
app.use('/api/pacifica', pacifica);

app.listen(PORT, () => {
  console.log(`PerpsDAO Vault running on port ${PORT}`);
  console.log(`Frontend → http://localhost:${PORT}`);
  console.log(`Pacifica → http://localhost:${PORT}/api/pacifica/markets`);
});
