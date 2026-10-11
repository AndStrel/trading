import { readFileSync, writeFileSync } from 'node:fs';
import { digest, loadVerifiedCandles } from './research/verified-candles.js';
import { dayVwapPasses, simulateDayVwap, type DayVwapTrade } from './research/candle-day-vwap.js';

const protocolSha256 = digest(readFileSync('docs/CANDLE_DAY_VWAP_2024_2025_V1.md'));
if (protocolSha256 !== '8eec68fb411a78f1083777386de3fc26d8adaeeaadc101de5450bf86bd4b0a62') throw new Error('Frozen day-vwap protocol changed');

const sources = loadVerifiedCandles().filter((source) => (source.year === 2024 || source.year === 2025) && (source.ticker === 'SBER' || source.ticker === 'GAZP'));
const byName = new Map<string, { trades: DayVwapTrade[]; unresolved: { day: string; pattern: 'U' | 'D' }[] }>();
for (const source of sources) {
  const result = simulateDayVwap(source.data);
  const prior = byName.get(source.ticker) ?? { trades: [], unresolved: [] };
  prior.trades.push(...result.trades);
  prior.unresolved.push(...result.unresolved);
  byName.set(source.ticker, prior);
}

function summarize(trades: DayVwapTrade[]) {
  const mean = (values: number[]) => values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    trades: trades.length,
    winRate: trades.length === 0 ? null : trades.filter((trade) => trade.netPct > 0).length / trades.length,
    meanNetPct: mean(trades.map((trade) => trade.netPct)),
    meanStressPct: mean(trades.map((trade) => trade.stressPct)),
  };
}

const names = ['SBER', 'GAZP'] as const;
const groups = (['U', 'D'] as const).map((pattern) => {
  const slice = (name: typeof names[number], year: string) => (byName.get(name)?.trades ?? []).filter((trade) => trade.pattern === pattern && trade.day.startsWith(year));
  const holes = (year: string) => names.reduce((sum, name) => sum + (byName.get(name)?.unresolved.filter((item) => item.pattern === pattern && item.day.startsWith(year)).length ?? 0), 0);
  const selected = holes('2024') === 0 && names.every((name) => dayVwapPasses(slice(name, '2024'), false));
  const confirmed = selected && holes('2025') === 0 && names.every((name) => dayVwapPasses(slice(name, '2025'), true));
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
  experiment: 'candle-day-vwap-2024-2025-v1',
  protocolSha256,
  tariff: 'trader-before-subscription',
  profitable: groups.filter((group) => group.confirmed).map((group) => group.pattern),
  groups,
};
writeFileSync('.trading/candle-day-vwap-2024-2025-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({
  profitable: report.profitable,
  groups: groups.map(({ confirmation, ...group }) => group),
}, null, 2));
