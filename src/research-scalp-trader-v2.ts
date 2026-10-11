import { readFileSync, writeFileSync } from 'node:fs';
import { digest, loadVerifiedCandles } from './research/verified-candles.js';
import { scalpGateReasons } from './research/scalp-trader.js';
import { simulateHourlyHold, simulateSberLag, type HourlyKind, type ScalpV2Trade } from './research/scalp-trader-v2.js';

const protocolSha256 = digest(readFileSync('docs/SCALP_TRADER_V2.md'));
if (protocolSha256 !== 'e30ae7b33b56a9ba3adc1277e728a7b64bd4d4cd6ef500a003728dd94cfc0afc') throw new Error('Frozen scalp v2 protocol changed');

const sources = loadVerifiedCandles().filter((source) => source.year === 2024 || source.year === 2025);

function summarize(kind: string, parts: { trades: ScalpV2Trade[]; unresolved: string[]; sessionDays: number }[]) {
  const trades = parts.flatMap((part) => part.trades);
  const unresolved = parts.reduce((sum, part) => sum + part.unresolved.length, 0);
  const sessionDays = parts.reduce((sum, part) => sum + part.sessionDays, 0);
  const mean = (year?: number) => {
    const sample = year === undefined ? trades : trades.filter((item) => item.day.startsWith(String(year)));
    return sample.length === 0 ? null : sample.reduce((sum, item) => sum + item.netPct, 0) / sample.length;
  };
  return {
    kind,
    trades: trades.length,
    unresolved,
    sessionDays,
    tradesPerSessionDay: sessionDays === 0 ? null : trades.length / sessionDays,
    winners: trades.filter((item) => item.netPct > 0).length,
    winRate: trades.length === 0 ? null : trades.filter((item) => item.netPct > 0).length / trades.length,
    meanNetPct: mean(),
    meanStressPct: trades.length === 0 ? null : trades.reduce((sum, item) => sum + item.stressPct, 0) / trades.length,
    mean2024: mean(2024),
    mean2025: mean(2025),
    reasons: scalpGateReasons(trades, sessionDays, unresolved),
  };
}

const hourly = (kind: HourlyKind) => summarize(kind, sources.map((source) => simulateHourlyHold(source.ticker, source.data, kind)));
const sber = sources.filter((source) => source.ticker === 'SBER');
const gazp = sources.filter((source) => source.ticker === 'GAZP');
const years = [2024, 2025].map((year) => {
  const left = sber.find((source) => source.year === year);
  const right = gazp.find((source) => source.year === year);
  if (!left || !right) throw new Error(`Missing SBER/GAZP source for ${year}`);
  return simulateSberLag(left.data, right.data);
});
const rules = [hourly('hourly-continuation'), hourly('hourly-fade'), summarize('sber-lag-gazp', years)].map((rule) => ({
  ...rule,
  status: rule.reasons.length === 0 ? 'not-tradeable-pending-audit' : 'not-admitted',
}));
const report = { experiment: 'scalp-trader-v2', protocolSha256, tariff: 'trader-before-subscription', rules };
writeFileSync('.trading/scalp-trader-v2.json', JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify(report, null, 2));
