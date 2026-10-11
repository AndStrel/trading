import { readFileSync, writeFileSync } from 'node:fs';
import { digest, loadVerifiedCandles } from './research/verified-candles.js';
import { dayAgreePasses, simulateDayAgree, type DayAgreeTrade } from './research/candle-day-agree.js';

const protocolSha256 = digest(readFileSync('docs/CANDLE_DAY_AGREE_2024_2025_V1.md'));
if (protocolSha256 !== '738209ab292a393f806a0599409f203cf3fed56086c460f5610f8fde9d58b202') throw new Error('Frozen day-agree protocol changed');

const sources = loadVerifiedCandles().filter((source) => (source.year === 2024 || source.year === 2025) && (source.ticker === 'SBER' || source.ticker === 'GAZP'));
const byName = new Map<string, { trades: DayAgreeTrade[]; unresolved: { day: string; pattern: 'UU' | 'DD' }[] }>();
for (const source of sources) {
  const result = simulateDayAgree(source.data);
  const prior = byName.get(source.ticker) ?? { trades: [], unresolved: [] };
  prior.trades.push(...result.trades);
  prior.unresolved.push(...result.unresolved);
  byName.set(source.ticker, prior);
}

function summarize(trades: DayAgreeTrade[]) {
  const mean = (values: number[]) => values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    trades: trades.length,
    winRate: trades.length === 0 ? null : trades.filter((trade) => trade.netPct > 0).length / trades.length,
    meanNetPct: mean(trades.map((trade) => trade.netPct)),
    meanStressPct: mean(trades.map((trade) => trade.stressPct)),
  };
}

const names = ['SBER', 'GAZP'] as const;
const groups = (['UU', 'DD'] as const).map((pattern) => {
  const slice = (name: typeof names[number], year: string) => (byName.get(name)?.trades ?? []).filter((trade) => trade.pattern === pattern && trade.day.startsWith(year));
  const holes = (year: string) => names.reduce((sum, name) => sum + (byName.get(name)?.unresolved.filter((item) => item.pattern === pattern && item.day.startsWith(year)).length ?? 0), 0);
  const selected = holes('2024') === 0 && names.every((name) => dayAgreePasses(slice(name, '2024'), false));
  const confirmed = selected && holes('2025') === 0 && names.every((name) => dayAgreePasses(slice(name, '2025'), true));
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
  experiment: 'candle-day-agree-2024-2025-v1',
  protocolSha256,
  tariff: 'trader-before-subscription',
  profitable: groups.filter((group) => group.confirmed).map((group) => group.pattern),
  groups,
};
writeFileSync('.trading/candle-day-agree-2024-2025-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({
  profitable: report.profitable,
  groups: groups.map(({ confirmation, ...group }) => group),
}, null, 2));
