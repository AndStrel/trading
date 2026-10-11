import { readFileSync, writeFileSync } from 'node:fs';
import { digest, loadVerifiedCandles } from './research/verified-candles.js';
import { highPlacePasses, simulateHighPlace, type HighPlaceTrade } from './research/candle-high-place.js';

const protocolSha256 = digest(readFileSync('docs/CANDLE_HIGH_PLACE_2024_2025_V1.md'));
if (protocolSha256 !== 'cbf09a22529807540ffefb04fa179231ae363009847e7f5327151de0b465061f') throw new Error('Frozen high-place protocol changed');

const sources = loadVerifiedCandles().filter((source) => (source.year === 2024 || source.year === 2025) && (source.ticker === 'SBER' || source.ticker === 'GAZP'));
const byName = new Map<string, { trades: HighPlaceTrade[]; unresolved: { day: string; pattern: 'E' | 'M' | 'L' }[] }>();
for (const source of sources) {
  const result = simulateHighPlace(source.data);
  const prior = byName.get(source.ticker) ?? { trades: [], unresolved: [] };
  prior.trades.push(...result.trades);
  prior.unresolved.push(...result.unresolved);
  byName.set(source.ticker, prior);
}

function summarize(trades: HighPlaceTrade[]) {
  const mean = (values: number[]) => values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    trades: trades.length,
    winRate: trades.length === 0 ? null : trades.filter((trade) => trade.netPct > 0).length / trades.length,
    meanNetPct: mean(trades.map((trade) => trade.netPct)),
    meanStressPct: mean(trades.map((trade) => trade.stressPct)),
  };
}

const names = ['SBER', 'GAZP'] as const;
const groups = (['E', 'M', 'L'] as const).map((pattern) => {
  const slice = (name: typeof names[number], year: string) => (byName.get(name)?.trades ?? []).filter((trade) => trade.pattern === pattern && trade.day.startsWith(year));
  const holes = (year: string) => names.reduce((sum, name) => sum + (byName.get(name)?.unresolved.filter((item) => item.pattern === pattern && item.day.startsWith(year)).length ?? 0), 0);
  const selected = holes('2024') === 0 && names.every((name) => highPlacePasses(slice(name, '2024'), false));
  const confirmed = selected && holes('2025') === 0 && names.every((name) => highPlacePasses(slice(name, '2025'), true));
  return {
    pattern,
    selected,
    confirmed,
    unresolved2024: holes('2024'),
    discovery: Object.fromEntries(names.map((name) => [name, summarize(slice(name, '2024'))])),
    confirmation: Object.fromEntries(names.map((name) => [name, summarize(slice(name, '2025'))])),
  };
});
const report = {
  experiment: 'candle-high-place-2024-2025-v1',
  protocolSha256,
  tariff: 'trader-before-subscription',
  profitable: groups.filter((group) => group.confirmed).map((group) => group.pattern),
  groups,
};
writeFileSync('.trading/candle-high-place-2024-2025-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({
  profitable: report.profitable,
  groups: groups.map(({ confirmation, ...group }) => group),
}, null, 2));
