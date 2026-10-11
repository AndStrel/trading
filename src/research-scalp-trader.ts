import { readFileSync, writeFileSync } from 'node:fs';
import { digest, loadVerifiedCandles } from './research/verified-candles.js';
import { scalpGateReasons, simulateScalp, type ScalpKind, type ScalpTrade } from './research/scalp-trader.js';

const protocolSha256 = digest(readFileSync('docs/SCALP_TRADER_V1.md'));
if (protocolSha256 !== '3fb6909dce97e81b9b5c1c8bc535334a876c9b6161ce7bb1e27248a5b40aef1d') throw new Error('Frozen scalp protocol changed');

const kinds: ScalpKind[] = ['five-minute-continuation', 'five-minute-fade', 'vwap-reclaim'];
const sources = loadVerifiedCandles().filter((source) => source.year === 2024 || source.year === 2025);

function run(kind: ScalpKind) {
  const results = sources.map((source) => simulateScalp(source.ticker, source.data, kind));
  const trades = results.flatMap((result) => result.trades);
  const unresolved = results.flatMap((result) => result.unresolved);
  const sessionDays = results.reduce((sum, result) => sum + result.sessionDays, 0);
  const mean = (rows: ScalpTrade[], year?: number) => {
    const sample = year === undefined ? rows : rows.filter((trade) => trade.day.startsWith(String(year)));
    if (sample.length === 0) return null;
    return sample.reduce((sum, trade) => sum + trade.netPct, 0) / sample.length;
  };
  return {
    kind,
    trades: trades.length,
    unresolved: unresolved.length,
    sessionDays,
    tradesPerSessionDay: sessionDays === 0 ? null : trades.length / sessionDays,
    winners: trades.filter((trade) => trade.netPct > 0).length,
    winRate: trades.length === 0 ? null : trades.filter((trade) => trade.netPct > 0).length / trades.length,
    meanNetPct: mean(trades),
    meanStressPct: trades.length === 0 ? null : trades.reduce((sum, trade) => sum + trade.stressPct, 0) / trades.length,
    mean2024: mean(trades, 2024),
    mean2025: mean(trades, 2025),
    reasons: scalpGateReasons(trades, sessionDays, unresolved.length),
  };
}

const rules = kinds.map(run);
const report = {
  experiment: 'scalp-trader-v1',
  protocolSha256,
  tariff: 'trader-before-subscription',
  rules: rules.map((rule) => ({ ...rule, status: rule.reasons.length === 0 ? 'not-tradeable-pending-audit' : 'not-admitted' })),
};
writeFileSync('.trading/scalp-trader-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify(report, null, 2));
