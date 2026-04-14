import http from 'http';
import { EventEmitter } from 'events';

const eventBus = new EventEmitter();

const vaults = new Map();
const strategies = new Map();
const userShares = new Map();
const governanceProposals = new Map();
const trades = new Map();

let vaultIdCounter = 1;
let strategyIdCounter = 1;
let proposalIdCounter = 1;
let tradeIdCounter = 1;

function generateId(prefix) {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}_${timestamp}_${random}`;
}

function calculateFees(amount, feeRate) {
  return amount * feeRate;
}

function validateAddress(address) {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

class Strategy {
  constructor(data) {
    this.id = strategyIdCounter++;
    this.nftId = generateId('NFT');
    this.name = data.name;
    this.description = data.description || '';
    this.creator = data.creator;
    this.parameters = data.parameters || {};
    this.riskLevel = data.riskLevel || 'medium';
    this.performanceFee = data.performanceFee || 0.2;
    this.managementFee = data.managementFee || 0.02;
    this.createdAt = Date.now();
    this.updatedAt = Date.now();
    this.totalPnL = 0;
    this.tradeCount = 0;
    this.active = true;
  }

  toJSON() {
    return {
      id: this.id,
      nftId: this.nftId,
      name: this.name,
      description: this.description,
      creator: this.creator,
      parameters: this.parameters,
      riskLevel: this.riskLevel,
      performanceFee: this.performanceFee,
      managementFee: this.managementFee,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      totalPnL: this.totalPnL,
      tradeCount: this.tradeCount,
      active: this.active
    };
  }
}

class Vault {
  constructor(data) {
    this.id = vaultIdCounter++;
    this.name = data.name;
    this.strategyId = data.strategyId;
    this.manager = data.manager;
    this.totalAssets = 0;
    this.totalShares = 0;
    this.sharePrice = 1;
    this.deposits = [];
    this.withdrawals = [];
    this.createdAt = Date.now();
    this.updatedAt = Date.now();
    this.active = true;
    this.minDeposit = data.minDeposit || 100;
    this.maxCapacity = data.maxCapacity || 1000000;
  }

  deposit(user, amount) {
    if (amount < this.minDeposit) {
      throw new Error(`Minimum deposit is ${this.minDeposit}`);
    }
    if (this.totalAssets + amount > this.maxCapacity) {
      throw new Error('Vault capacity exceeded');
    }

    const shares = this.sharePrice > 0 ? amount / this.sharePrice : amount;
    this.totalAssets += amount;
    this.totalShares += shares;

    const userKey = `${this.id}_${user}`;
    const currentShares = userShares.get(userKey) || 0;
    userShares.set(userKey, currentShares + shares);

    this.deposits.push({
      user,
      amount,
      shares,
      timestamp: Date.now()
    });

    this.updatedAt = Date.now();
    return { shares, sharePrice: this.sharePrice };
  }

  withdraw(user, shares) {
    const userKey = `${this.id}_${user}`;
    const currentShares = userShares.get(userKey) || 0;

    if (shares > currentShares) {
      throw new Error('Insufficient shares');
    }

    const amount = shares * this.sharePrice;
    this.totalAssets -= amount;
    this.totalShares -= shares;
    userShares.set(userKey, currentShares - shares);

    this.withdrawals.push({
      user,
      amount,
      shares,
      timestamp: Date.now()
    });

    this.updatedAt = Date.now();
    return { amount, sharePrice: this.sharePrice };
  }

  updatePnL(pnl) {
    this.totalAssets += pnl;
    if (this.totalShares > 0) {
      this.sharePrice = this.totalAssets / this.totalShares;
    }
    this.updatedAt = Date.now();
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      strategyId: this.strategyId,
      manager: this.manager,
      totalAssets: this.totalAssets,
      totalShares: this.totalShares,
      sharePrice: this.sharePrice,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      active: this.active,
      minDeposit: this.minDeposit,
      maxCapacity: this.maxCapacity
    };
  }
}

class GovernanceProposal {
  constructor(data) {
    this.id = proposalIdCounter++;
    this.title = data.title;
    this.description = data.description;
    this.proposer = data.proposer;
    this.strategyId = data.strategyId;
    this.vaultId = data.vaultId;
    this.type = data.type;
    this.parameters = data.parameters || {};
    this.votesFor = 0;
    this.votesAgainst = 0;
    this.voters = new Set();
    this.status = 'active';
    this.createdAt = Date.now();
    this.endTime = Date.now() + (data.duration || 7 * 24 * 60 * 60 * 1000);
  }

  vote(voter, support, weight) {
    if (this.voters.has(voter)) {
      throw new Error('Already voted');
    }
    if (Date.now() > this.endTime) {
      throw new Error('Voting ended');
    }

    this.voters.add(voter);
    if (support) {
      this.votesFor += weight;
    } else {
      this.votesAgainst += weight;
    }

    return { votesFor: this.votesFor, votesAgainst: this.votesAgainst };
  }

  finalize() {
    if (Date.now() < this.endTime) {
      throw new Error('Voting not ended');
    }
    this.status = this.votesFor > this.votesAgainst ? 'passed' : 'rejected';
    return this.status;
  }

  toJSON() {
    return {
      id: this.id,
      title: this.title,
      description: this.description,
      proposer: this.proposer,
      strategyId: this.strategyId,
      vaultId: this.vaultId,
      type: this.type,
      parameters: this.parameters,
      votesFor: this.votesFor,
      votesAgainst: this.votesAgainst,
      voterCount: this.voters.size,
      status: this.status,
      createdAt: this.createdAt,
      endTime: this.endTime
    };
  }
}

class PacificaClient {
  constructor() {
    this.baseUrl = 'https://api.pacifica.fi';
    this.positions = new Map();
  }

  async openPosition(params) {
    const position = {
      id: generateId('POS'),
      market: params.market,
      side: params.side,
      size: params.size,
      leverage: params.leverage || 1,
      entryPrice: params.price || this.getMockPrice(params.market),
      timestamp: Date.now(),
      status: 'open',
      pnl: 0
    };
    this.positions.set(position.id, position);
    return position;
  }

  async closePosition(positionId) {
    const position = this.positions.get(positionId);
    if (!position) {
      throw new Error('Position not found');
    }

    const exitPrice = this.getMockPrice(position.market);
    const priceDiff = exitPrice - position.entryPrice;
    const pnl = position.side === 'long' 
      ? priceDiff * position.size * position.leverage
      : -priceDiff * position.size * position.leverage;

    position.exitPrice = exitPrice;
    position.pnl = pnl;
    position.status = 'closed';
    position.closedAt = Date.now();

    return position;
  }

  getMockPrice(market) {
    const basePrices = {
      'BTC-USD': 65000,
      'ETH-USD': 3500,
      'SOL-USD': 150
    };
    const base = basePrices[market] || 100;
    return base * (0.98 + Math.random() * 0.04);
  }

  async getMarkets() {
    return [
      { symbol: 'BTC-USD', name: 'Bitcoin', price: this.getMockPrice('BTC-USD') },
      { symbol: 'ETH-USD', name: 'Ethereum', price: this.getMockPrice('ETH-USD') },
      { symbol: 'SOL-USD', name: 'Solana', price: this.getMockPrice('SOL-USD') }
    ];
  }
}

class RhinofiBridge {
  constructor() {
    this.pendingBridges = new Map();
  }

  async initiateBridge(params) {
    const bridgeId = generateId('BRIDGE');
    const bridge = {
      id: bridgeId,
      from: params.fromChain,
      to: params.toChain,
      token: params.token,
      amount: params.amount,
      sender: params.sender,
      recipient: params.recipient,
      status: 'pending',
      createdAt: Date.now()
    };
    this.pendingBridges.set(bridgeId, bridge);

    setTimeout(() => {
      bridge.status = 'completed';
      bridge.completedAt = Date.now();
    }, 5000);

    return bridge;
  }

  async getBridgeStatus(bridgeId) {
    return this.pendingBridges.get(bridgeId) || null;
  }
}

const pacificaClient = new PacificaClient();
const rhinofiBridge = new RhinofiBridge();

function createStrategy(data) {
  if (!data.name || !data.creator) {
    throw new Error('Name and creator required');
  }
  const strategy = new Strategy(data);
  strategies.set(strategy.id, strategy);
  eventBus.emit('strategy:created', strategy);
  return strategy;
}

function getStrategy(id) {
  return strategies.get(parseInt(id)) || null;
}

function listStrategies() {
  return Array.from(strategies.values()).map(s => s.toJSON());
}

function createVault(data) {
  if (!data.name || !data.strategyId || !data.manager) {
    throw new Error('Name, strategyId, and manager required');
  }
  const strategy = strategies.get(parseInt(data.strategyId));
  if (!strategy) {
    throw new Error('Strategy not found');
  }
  const vault = new Vault(data);
  vaults.set(vault.id, vault);
  eventBus.emit('vault:created', vault);
  return vault;
}

function getVault(id) {
  return vaults.get(parseInt(id)) || null;
}

function listVaults() {
  return Array.from(vaults.values()).map(v => v.toJSON());
}

function depositToVault(vaultId, user, amount) {
  const vault = vaults.get(parseInt(vaultId));
  if (!vault) {
    throw new Error('Vault not found');
  }
  const result = vault.deposit(user, amount);
  eventBus.emit('vault:deposit', { vaultId, user, amount, ...result });
  return result;
}

function withdrawFromVault(vaultId, user, shares) {
  const vault = vaults.get(parseInt(vaultId));
  if (!vault) {
    throw new Error('Vault not found');
  }
  const result = vault.withdraw(user, shares);
  eventBus.emit('vault:withdraw', { vaultId, user, shares, ...result });
  return result;
}

function getUserShares(vaultId, user) {
  const userKey = `${vaultId}_${user}`;
  return userShares.get(userKey) || 0;
}

function createProposal(data) {
  if (!data.title || !data.proposer) {
    throw new Error('Title and proposer required');
  }
  const proposal = new GovernanceProposal(data);
  governanceProposals.set(proposal.id, proposal);
  eventBus.emit('proposal:created', proposal);
  return proposal;
}

function voteOnProposal(proposalId, voter, support, weight = 1) {
  const proposal = governanceProposals.get(parseInt(proposalId));
  if (!proposal) {
    throw new Error('Proposal not found');
  }
  return proposal.vote(voter, support, weight);
}

function listProposals() {
  return Array.from(governanceProposals.values()).map(p => p.toJSON());
}

async function executeTrade(vaultId, params) {
  const vault = vaults.get(parseInt(vaultId));
  if (!vault) {
    throw new Error('Vault not found');
  }

  const position = await pacificaClient.openPosition(params);
  const trade = {
    id: tradeIdCounter++,
    vaultId,
    positionId: position.id,
    market: params.market,
    side: params.side,
    size: params.size,
    leverage: params.leverage,
    entryPrice: position.entryPrice,
    status: 'open',
    createdAt: Date.now()
  };
  trades.set(trade.id, trade);

  const strategy = strategies.get(vault.strategyId);
  if (strategy) {
    strategy.tradeCount++;
  }

  return trade;
}

async function closeTrade(tradeId) {
  const trade = trades.get(parseInt(tradeId));
  if (!trade) {
    throw new Error('Trade not found');
  }

  const closedPosition = await pacificaClient.closePosition(trade.positionId);
  trade.exitPrice = closedPosition.exitPrice;
  trade.pnl = closedPosition.pnl;
  trade.status = 'closed';
  trade.closedAt = Date.now();

  const vault = vaults.get(trade.vaultId);
  if (vault) {
    const strategy = strategies.get(vault.strategyId);
    const performanceFee = strategy ? calculateFees(Math.max(0, trade.pnl), strategy.performanceFee) : 0;
    vault.updatePnL(trade.pnl - performanceFee);

    if (strategy) {
      strategy.totalPnL += trade.pnl;
    }
  }

  return trade;
}

function listTrades(vaultId) {
  return Array.from(trades.values())
    .filter(t => !vaultId || t.vaultId === parseInt(vaultId))
    .map(t => ({ ...t }));
}

async function bridgeAssets(params) {
  return rhinofiBridge.initiateBridge(params);
}

async function getBridgeStatus(bridgeId) {
  return rhinofiBridge.getBridgeStatus(bridgeId);
}

function calculateRiskMetrics(vaultId) {
  const vaultTrades = listTrades(vaultId);
  const closedTrades = vaultTrades.filter(t => t.status === 'closed');

  if (closedTrades.length === 0) {
    return { sharpeRatio: 0, maxDrawdown: 0, winRate: 0, avgPnL: 0 };
  }

  const pnls = closedTrades.map(t => t.pnl);
  const avgPnL = pnls.reduce((a, b) => a + b, 0) / pnls.length;
  const winRate = pnls.filter(p => p > 0).length / pnls.length;

  const variance = pnls.reduce((acc, p) => acc + Math.pow(p - avgPnL, 2), 0) / pnls.length;
  const stdDev = Math.sqrt(variance);
  const sharpeRatio = stdDev > 0 ? avgPnL / stdDev : 0;

  let peak = 0;
  let maxDrawdown = 0;
  let cumulative = 0;
  for (const pnl of pnls) {
    cumulative += pnl;
    if (cumulative > peak) peak = cumulative;
    const drawdown = peak - cumulative;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  return { sharpeRatio, maxDrawdown, winRate, avgPnL };
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJSON(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function sendError(res, message, status = 400) {
  sendJSON(res, { error: message }, status);
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  const method = req.method;

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  try {
    if (path === '/' && method === 'GET') {
      sendJSON(res, {
        name: 'PerpsDAO Vault',
        version: '1.0.0',
        description: 'Decentralized Perpetual Strategy Vault',
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
          'GET /api/markets'
        ]
      });
      return;
    }

    if (path === '/api/strategies' && method === 'GET') {
      sendJSON(res, { strategies: listStrategies() });
      return;
    }

    if (path === '/api/strategies' && method === 'POST') {
      const body = await parseBody(req);
      const strategy = createStrategy(body);
      sendJSON(res, { strategy: strategy.toJSON() }, 201);
      return;
    }

    const strategyMatch = path.match(/^\/api\/strategies\/(\d+)$/);
    if (strategyMatch && method === 'GET') {
      const strategy = getStrategy(strategyMatch[1]);
      if (!strategy) {
        sendError(res, 'Strategy not found', 404);
        return;
      }
      sendJSON(res, { strategy: strategy.toJSON() });
      return;
    }

    if (path === '/api/vaults' && method === 'GET') {
      sendJSON(res, { vaults: listVaults() });
      return;
    }

    if (path === '/api/vaults' && method === 'POST') {
      const body = await parseBody(req);
      const vault = createVault(body);
      sendJSON(res, { vault: vault.toJSON() }, 201);
      return;
    }

    const vaultMatch = path.match(/^\/api\/vaults\/(\d+)$/);
    if (vaultMatch && method === 'GET') {
      const vault = getVault(vaultMatch[1]);
      if (!vault) {
        sendError(res, 'Vault not found', 404);
        return;
      }
      const metrics = calculateRiskMetrics(parseInt(vaultMatch[1]));
      sendJSON(res, { vault: vault.toJSON(), metrics });
      return;
    }

    const depositMatch = path.match(/^\/api\/vaults\/(\d+)\/deposit$/);
    if (depositMatch && method === 'POST') {
      const body = await parseBody(req);
      const result = depositToVault(depositMatch[1], body.user, body.amount);
      sendJSON(res, result);
      return;
    }

    const withdrawMatch = path.match(/^\/api\/vaults\/(\d+)\/withdraw$/);
    if (withdrawMatch && method === 'POST') {
      const body = await parseBody(req);
      const result = withdrawFromVault(withdrawMatch[1], body.user, body.shares);
      sendJSON(res, result);
      return;
    }

    const sharesMatch = path.match(/^\/api\/vaults\/(\d+)\/shares\/(.+)$/);
    if (sharesMatch && method === 'GET') {
      const shares = getUserShares(parseInt(sharesMatch[1]), sharesMatch[2]);
      sendJSON(res, { shares });
      return;
    }

    if (path === '/api/governance' && method === 'GET') {
      sendJSON(res, { proposals: listProposals() });
      return;
    }

    if (path === '/api/governance' && method === 'POST') {
      const body = await parseBody(req);
      const proposal = createProposal(body);
      sendJSON(res, { proposal: proposal.toJSON() }, 201);
      return;
    }

    const voteMatch = path.match(/^\/api\/governance\/(\d+)\/vote$/);
    if (voteMatch && method === 'POST') {
      const body = await parseBody(req);
      const result = voteOnProposal(voteMatch[1], body.voter, body.support, body.weight);
      sendJSON(res, result);
      return;
    }

    if (path === '/api/trades' && method === 'GET') {
      const vaultId = url.searchParams.get('vaultId');
      sendJSON(res, { trades: listTrades(vaultId ? parseInt(vaultId) : null) });
      return;
    }

    if (path === '/api/trades' && method === 'POST') {
      const body = await parseBody(req);
      const trade = await executeTrade(body.vaultId, body);
      sendJSON(res, { trade }, 201);
      return;
    }

    const closeTradeMatch = path.match(/^\/api\/trades\/(\d+)\/close$/);
    if (closeTradeMatch && method === 'POST') {
      const trade = await closeTrade(closeTradeMatch[1]);
      sendJSON(res, { trade });
      return;
    }

    if (path === '/api/bridge' && method === 'POST') {
      const body = await parseBody(req);
      const bridge = await bridgeAssets(body);
      sendJSON(res, { bridge }, 201);
      return;
    }

    const bridgeStatusMatch = path.match(/^\/api\/bridge\/(.+)$/);
    if (bridgeStatusMatch && method === 'GET') {
      const status = await getBridgeStatus(bridgeStatusMatch[1]);
      if (!status) {
        sendError(res, 'Bridge not found', 404);
        return;
      }
      sendJSON(res, { bridge: status });
      return;
    }

    if (path === '/api/markets' && method === 'GET') {
      const markets = await pacificaClient.getMarkets();
      sendJSON(res, { markets });
      return;
    }

    if (path === '/health' && method === 'GET') {
      sendJSON(res, { status: 'ok', timestamp: Date.now() });
      return;
    }

    sendError(res, 'Not found', 404);
  } catch (err) {
    sendError(res, err.message, 500);
  }
}

export default async function runApp({ port }) {
  const server = http.createServer(handleRequest);
  
  return new Promise((resolve) => {
    server.listen(port, '0.0.0.0', () => {
      console.log(`PerpsDAO Vault running on http://0.0.0.0:${port}`);
      resolve(server);
    });
  });
}