import { readFileSync, writeFileSync } from 'node:fs';
import { digest, loadVerifiedCandles } from './research/verified-candles.js';
import { closeHourPasses, simulateCloseHour, type CloseHourTrade } from './research/candle-close-hour.js';

const protocolSha256 = digest(readFileSync('docs/CANDLE_CLOSE_HOUR_2024_2025_V1.md'));
if (protocolSha256 !== '29cc6e43f5b817a26e43e8fbf72d3994a51455a195e3201aa79bb658f56a1bca') throw new Error('Frozen close-hour protocol changed');

const sources = loadVerifiedCandles().filter((source) => (source.year === 2024 || source.year === 2025) && (source.ticker === 'SBER' || source.ticker === 'GAZP'));
const byName = new Map<string, { trades: CloseHourTrade[]; unresolved: { day: string; pattern: 'U' | 'D' }[] }>();
for (const source of sources) {
  const result = simulateCloseHour(source.data);
  const prior = byName.get(source.ticker) ?? { trades: [], unresolved: [] };
  prior.trades.push(...result.trades);
  prior.unresolved.push(...result.unresolved);
  byName.set(source.ticker, prior);
}

function summarize(trades: CloseHourTrade[]) {
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
  const unresolved = names.reduce((sum, name) => sum + (byName.get(name)?.unresolved.filter((item) => item.pattern === pattern).length ?? 0), 0);
  const selected = unresolved === 0 && names.every((name) => closeHourPasses(slice(name, '2024'), false));
  const confirmed = selected && names.every((name) => closeHourPasses(slice(name, '2025'), true));
  return {
    pattern,
    selected,
    confirmed,
    unresolved,
    discovery: Object.fromEntries(names.map((name) => [name, summarize(slice(name, '2024'))])),
    confirmation: Object.fromEntries(names.map((name) => [name, summarize(slice(name, '2025'))])),
  };
});
const report = {
  experiment: 'candle-close-hour-2024-2025-v1',
  protocolSha256,
  tariff: 'trader-before-subscription',
  profitable: groups.filter((group) => group.confirmed).map((group) => group.pattern),
  groups,
};
writeFileSync('.trading/candle-close-hour-2024-2025-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ profitable: report.profitable, groups: groups.map(({ confirmation, ...group }) => group) }, null, 2));
