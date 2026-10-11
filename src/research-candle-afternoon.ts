import { readFileSync, writeFileSync } from 'node:fs';
import { digest, loadVerifiedCandles } from './research/verified-candles.js';
import { simulateAfternoon, type AfternoonTrade } from './research/candle-afternoon.js';

const protocolSha256 = digest(readFileSync('docs/CANDLE_AFTERNOON_2024_2025_V1.md'));
if (protocolSha256 !== '8d217315c06b1a2aa64c0d0e6a4af89169e8b0d471e4f319d4e04ab7ed4df598') throw new Error('Frozen afternoon protocol changed');

const sources = loadVerifiedCandles().filter((source) => (source.year === 2024 || source.year === 2025) && (source.ticker === 'SBER' || source.ticker === 'GAZP'));
const byName = new Map<string, { trades: AfternoonTrade[]; unresolved: { day: string; pattern: 'U' | 'D' }[] }>();
for (const source of sources) {
  const result = simulateAfternoon(source.data);
  const prior = byName.get(source.ticker) ?? { trades: [], unresolved: [] };
  prior.trades.push(...result.trades);
  prior.unresolved.push(...result.unresolved);
  byName.set(source.ticker, prior);
}

function stats(trades: AfternoonTrade[]) {
  const mean = (values: number[]) => values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
  const winners = trades.filter((trade) => trade.netPct > 0).length;
  return {
    trades: trades.length,
    winRate: trades.length === 0 ? null : winners / trades.length,
    meanNetPct: mean(trades.map((trade) => trade.netPct)),
    meanStressPct: mean(trades.map((trade) => trade.stressPct)),
  };
}

function passes(trades: AfternoonTrade[], requireStress: boolean): boolean {
  const sample = stats(trades);
  return sample.trades >= 20 && sample.winRate !== null && sample.winRate >= 0.51 && sample.meanNetPct !== null && sample.meanNetPct > 0 &&
    (!requireStress || (sample.meanStressPct !== null && sample.meanStressPct > 0));
}

const names = ['SBER', 'GAZP'] as const;
const groups = (['U', 'D'] as const).map((pattern) => {
  const yearStats = (year: string) => Object.fromEntries(names.map((name) => {
    const book = byName.get(name);
    return [name, stats((book?.trades ?? []).filter((trade) => trade.pattern === pattern && trade.day.startsWith(year)))];
  }));
  const discoveryTrades = (name: typeof names[number]) => (byName.get(name)?.trades ?? []).filter((trade) => trade.pattern === pattern && trade.day.startsWith('2024'));
  const confirmationTrades = (name: typeof names[number]) => (byName.get(name)?.trades ?? []).filter((trade) => trade.pattern === pattern && trade.day.startsWith('2025'));
  const unresolved = names.reduce((sum, name) => sum + (byName.get(name)?.unresolved.filter((item) => item.pattern === pattern).length ?? 0), 0);
  const selected = names.every((name) => passes(discoveryTrades(name), false));
  const confirmed = selected && unresolved === 0 && names.every((name) => passes(confirmationTrades(name), true));
  return { pattern, selected, confirmed, unresolved, discovery: yearStats('2024'), confirmation: yearStats('2025') };
});
const report = {
  experiment: 'candle-afternoon-2024-2025-v1',
  protocolSha256,
  tariff: 'trader-before-subscription',
  profitable: groups.filter((group) => group.confirmed).map((group) => group.pattern),
  groups,
};
writeFileSync('.trading/candle-afternoon-2024-2025-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ profitable: report.profitable, groups: groups.map((group) => ({ pattern: group.pattern, selected: group.selected, confirmed: group.confirmed, unresolved: group.unresolved, discovery: group.discovery })) }, null, 2));
