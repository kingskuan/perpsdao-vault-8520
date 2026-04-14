// pacifica.js — PerpsDAO Vault x Pacifica Integration (ES Module)
// Usage in index.js:
//   import pacifica from './pacifica.js';
//   app.use('/api/pacifica', pacifica);
//
// Adds these endpoints:
//   GET  /api/pacifica/markets         — live prices + funding from Pacifica
//   GET  /api/pacifica/funding/:symbol — funding rate history
//   GET  /api/pacifica/signal          — vault strategy signal (long/short bias)
//   POST /api/pacifica/backtest        — simulate vault PnL using real funding data

import express from 'express';
const router = express.Router();

const PACIFICA_API = 'https://api.pacifica.fi';

// ─── Helper: fetch with timeout ───────────────────────────────────────────────
async function pacificaFetch(path) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${PACIFICA_API}${path}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Pacifica API ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

// ─── GET /api/pacifica/markets ────────────────────────────────────────────────
// Live mark prices, funding rates, OI, 24h volume for all Pacifica markets
router.get('/markets', async (req, res) => {
  try {
    const [prices, info] = await Promise.all([
      pacificaFetch('/api/v1/info/prices'),
      pacificaFetch('/api/v1/info'),
    ]);

    // Build a lookup map from info (max_leverage, lot_size, etc.)
    const specMap = {};
    if (info.success && Array.isArray(info.data)) {
      for (const m of info.data) specMap[m.symbol] = m;
    }

    const markets = (prices.data || []).map((p) => {
      const spec = specMap[p.symbol] || {};
      return {
        symbol: p.symbol,
        source: 'pacifica',
        markPrice: parseFloat(p.mark),
        oraclePrice: parseFloat(p.oracle),
        midPrice: parseFloat(p.mid),
        fundingRate: parseFloat(p.funding),          // current hourly
        nextFundingRate: parseFloat(p.next_funding), // next predicted
        fundingAnnualized: parseFloat(p.funding) * 24 * 365 * 100, // % APR
        openInterest: parseFloat(p.open_interest),
        volume24h: parseFloat(p.volume_24h),
        yesterdayPrice: parseFloat(p.yesterday_price),
        priceChange24hPct: p.yesterday_price
          ? (((parseFloat(p.mark) - parseFloat(p.yesterday_price)) /
              parseFloat(p.yesterday_price)) * 100).toFixed(2)
          : null,
        maxLeverage: spec.max_leverage || null,
        minOrderSize: spec.min_order_size || null,
        timestamp: p.timestamp,
      };
    });

    // Sort by volume descending
    markets.sort((a, b) => b.volume24h - a.volume24h);

    res.json({
      source: 'pacifica',
      count: markets.length,
      updatedAt: Date.now(),
      markets,
    });
  } catch (err) {
    res.status(502).json({ error: 'Pacifica API unavailable', detail: err.message });
  }
});

// ─── GET /api/pacifica/funding/:symbol ───────────────────────────────────────
// Historical funding rates for a symbol (default BTC, limit 100)
router.get('/funding/:symbol', async (req, res) => {
  const symbol = (req.params.symbol || 'BTC').toUpperCase();
  const limit = Math.min(parseInt(req.query.limit) || 24, 500);
  try {
    const data = await pacificaFetch(
      `/api/v1/funding_rate/history?symbol=${symbol}&limit=${limit}`
    );

    const history = (data.data || []).map((h) => ({
      symbol,
      fundingRate: parseFloat(h.funding_rate),
      nextFundingRate: parseFloat(h.next_funding_rate),
      oraclePrice: parseFloat(h.oracle_price),
      fundingAnnualized: parseFloat(h.funding_rate) * 24 * 365 * 100,
      timestamp: h.created_at,
      datetime: new Date(h.created_at).toISOString(),
    }));

    // Summary stats
    const rates = history.map((h) => h.fundingRate);
    const avg = rates.reduce((a, b) => a + b, 0) / (rates.length || 1);
    const positive = rates.filter((r) => r > 0).length;
    const sentiment = positive / (rates.length || 1) > 0.6
      ? 'bullish'
      : positive / (rates.length || 1) < 0.4
      ? 'bearish'
      : 'neutral';

    res.json({
      symbol,
      source: 'pacifica',
      count: history.length,
      summary: {
        avgFundingRate: avg,
        avgAnnualizedPct: avg * 24 * 365 * 100,
        positivePeriods: positive,
        totalPeriods: rates.length,
        sentiment,
      },
      history,
    });
  } catch (err) {
    res.status(502).json({ error: 'Pacifica API unavailable', detail: err.message });
  }
});

// ─── GET /api/pacifica/signal ─────────────────────────────────────────────────
// Vault strategy signal: which markets to long/short based on funding rates
// Logic: if funding > 0 → shorts collect → signal = SHORT (or delta-neutral)
//        if funding < 0 → longs collect  → signal = LONG
router.get('/signal', async (req, res) => {
  try {
    const prices = await pacificaFetch('/api/v1/info/prices');
    const markets = prices.data || [];

    // Focus on major markets
    const watchlist = ['BTC', 'ETH', 'SOL'];
    const signals = [];

    for (const symbol of watchlist) {
      const m = markets.find((x) => x.symbol === symbol);
      if (!m) continue;

      const funding = parseFloat(m.funding);
      const annualized = funding * 24 * 365 * 100;
      let action, reason, confidence;

      if (funding > 0.0001) {
        action = 'SHORT_PERP';
        reason = 'Positive funding — shorts earn. Vault opens short perp position to collect.';
        confidence = Math.min(Math.abs(annualized) / 50, 1); // scale to 50% APR max
      } else if (funding < -0.0001) {
        action = 'LONG_PERP';
        reason = 'Negative funding — longs earn. Vault opens long perp position to collect.';
        confidence = Math.min(Math.abs(annualized) / 50, 1);
      } else {
        action = 'HOLD';
        reason = 'Funding near zero — no directional edge. Vault holds.';
        confidence = 0;
      }

      signals.push({
        symbol,
        markPrice: parseFloat(m.mark),
        fundingRate: funding,
        fundingAnnualizedPct: parseFloat(annualized.toFixed(4)),
        signal: action,
        confidence: parseFloat(confidence.toFixed(3)),
        reason,
        openInterest: parseFloat(m.open_interest),
        source: 'pacifica',
        timestamp: m.timestamp,
      });
    }

    // Overall vault recommendation
    const strongSignals = signals.filter((s) => s.confidence > 0.1);
    const vaultAction = strongSignals.length > 0
      ? `Deploy capital across ${strongSignals.map((s) => s.symbol).join(', ')} based on funding harvesting`
      : 'Hold — no strong funding rate opportunities detected';

    res.json({
      source: 'pacifica',
      generatedAt: new Date().toISOString(),
      vaultRecommendation: vaultAction,
      signals,
    });
  } catch (err) {
    res.status(502).json({ error: 'Pacifica API unavailable', detail: err.message });
  }
});

// ─── POST /api/pacifica/backtest ──────────────────────────────────────────────
// Simulate vault PnL if it had been collecting funding over last N hours
// Body: { symbol: "BTC", capitalUSDC: 10000, hours: 24 }
router.post('/backtest', async (req, res) => {
  const { symbol = 'BTC', capitalUSDC = 10000, hours = 24 } = req.body || {};
  const sym = symbol.toUpperCase();
  const limit = Math.min(parseInt(hours), 500);

  try {
    const data = await pacificaFetch(
      `/api/v1/funding_rate/history?symbol=${sym}&limit=${limit}`
    );
    const history = data.data || [];

    let cumulativePnL = 0;
    let cumulativeFundingPct = 0;
    const breakdown = [];

    for (const h of history) {
      const rate = parseFloat(h.funding_rate);
      // Vault collects funding by being on the right side
      // Simplified: collect absolute funding value (delta-neutral strategy)
      const periodPnL = Math.abs(rate) * capitalUSDC;
      cumulativePnL += periodPnL;
      cumulativeFundingPct += Math.abs(rate);

      breakdown.push({
        datetime: new Date(h.created_at).toISOString(),
        fundingRate: rate,
        periodPnL: parseFloat(periodPnL.toFixed(4)),
        cumulativePnL: parseFloat(cumulativePnL.toFixed(4)),
        oraclePrice: parseFloat(h.oracle_price),
      });
    }

    const annualizedAPY = cumulativeFundingPct * (8760 / (history.length || 1)) * 100;

    res.json({
      source: 'pacifica',
      symbol: sym,
      capitalUSDC,
      periodsAnalyzed: history.length,
      results: {
        totalPnLUSDC: parseFloat(cumulativePnL.toFixed(4)),
        totalReturnPct: parseFloat(((cumulativePnL / capitalUSDC) * 100).toFixed(4)),
        estimatedAnnualizedAPY: parseFloat(annualizedAPY.toFixed(2)),
        avgHourlyFundingPct: parseFloat((cumulativeFundingPct / (history.length || 1) * 100).toFixed(6)),
      },
      breakdown: breakdown.slice(0, 10), // show first 10 for brevity
      note: 'Simulation assumes delta-neutral vault collecting funding on both sides. Does not account for trading fees or slippage.',
    });
  } catch (err) {
    res.status(502).json({ error: 'Pacifica API unavailable', detail: err.message });
  }
});

export default router;
