import { readFileSync, writeFileSync } from 'node:fs';
import { digest, loadVerifiedCandles } from './research/verified-candles.js';
import { mondayHourPasses, simulateMondayHour, type MondayHourTrade } from './research/candle-monday-hour.js';

const protocolSha256 = digest(readFileSync('docs/CANDLE_MONDAY_HOUR_2024_2025_V1.md'));
if (protocolSha256 !== '3a5c6ef84cea509cfd10aa787a839db0f62349ae4d64a9f263e171eee89cd4a9') throw new Error('Frozen Monday-hour protocol changed');

const sources = loadVerifiedCandles().filter((source) => (source.year === 2024 || source.year === 2025) && (source.ticker === 'SBER' || source.ticker === 'GAZP'));
const names = ['SBER', 'GAZP'] as const;
const byName = new Map<typeof names[number], ReturnType<typeof simulateMondayHour>>();
for (const name of names) {
  const candles = sources.filter((source) => source.ticker === name).flatMap((source) => source.data);
  byName.set(name, simulateMondayHour(candles));
}

function summarize(trades: readonly MondayHourTrade[]) {
  const mean = (values: number[]) => values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    trades: trades.length,
    winRate: trades.length === 0 ? null : trades.filter((trade) => trade.netPct > 0).length / trades.length,
    meanNetPct: mean(trades.map((trade) => trade.netPct)),
    meanStressPct: mean(trades.map((trade) => trade.stressPct)),
  };
}

const groups = (['U', 'D'] as const).map((pattern) => {
  const slice = (name: typeof names[number], year: string) => (byName.get(name)?.trades ?? []).filter((trade) => trade.pattern === pattern && trade.day.startsWith(year));
  const unresolvedIn = (year: string) => names.reduce((sum, name) => sum + (byName.get(name)?.unresolved.filter((item) => item.pattern === pattern && item.day.startsWith(year)).length ?? 0), 0);
  const discoveryUnresolved = unresolvedIn('2024');
  const confirmationUnresolved = unresolvedIn('2025');
  const selected = discoveryUnresolved === 0 && names.every((name) => mondayHourPasses(slice(name, '2024'), false));
  const confirmed = selected && confirmationUnresolved === 0 && names.every((name) => mondayHourPasses(slice(name, '2025'), true));
  return {
    pattern,
    selected,
    confirmed,
    discoveryUnresolved,
    confirmationUnresolved,
    discovery: Object.fromEntries(names.map((name) => [name, summarize(slice(name, '2024'))])),
    confirmation: Object.fromEntries(names.map((name) => [name, summarize(slice(name, '2025'))])),
  };
});
const report = {
  experiment: 'candle-monday-hour-2024-2025-v1',
  protocolSha256,
  tariff: 'trader-before-subscription',
  profitable: groups.filter((group) => group.confirmed).map((group) => group.pattern),
  groups,
};
writeFileSync('.trading/candle-monday-hour-2024-2025-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({
  profitable: report.profitable,
  groups: groups.map(({ confirmation, ...group }) => group),
}, null, 2));
