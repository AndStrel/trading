import { readFileSync, writeFileSync } from 'node:fs';
import { digest } from './research/verified-candles.js';
import { patternStats } from './research/candle-pattern.js';
import { goldMonthPasses, simulateGoldMonth } from './research/candle-gold-month.js';
import type { DailyBar } from './research/weekly-trend.js';

const protocolSha256 = digest(readFileSync('docs/CANDLE_GOLD_MONTH_2024_2025_V1.md'));
if (protocolSha256 !== 'f400e6654040c55982e54583e531a0c0f5e9a6bfe609c9d9adc95dde9bd24fed') throw new Error('Frozen gold-month protocol changed');

const files = {
  TGLD: ['.trading/tgld-daily-2022-2025.json', '347575ab305338bcc9408be815366a5c12f37b164c10a5e08bf024a5e653ca2f'],
  PLZL: ['.trading/plzl-daily-2022-2025.json', '001bec15575548ca470b5ae3c4e529d6990583f3fc9426fb9369626422483d4c'],
} as const;

function load(path: string, sha: string): DailyBar[] {
  const source = JSON.parse(readFileSync(path, 'utf8')) as { rowsSha256: string; rows: DailyBar[] };
  if (source.rowsSha256 !== sha) throw new Error(`Frozen source changed: ${path}`);
  return source.rows;
}

const [signalPath, signalSha] = files.TGLD;
const [targetPath, targetSha] = files.PLZL;
const trades = simulateGoldMonth(load(signalPath, signalSha), load(targetPath, targetSha));
const groups = (['U', 'D'] as const).map((pattern) => {
  const slice = (year: string) => trades.filter((trade) => trade.pattern === pattern && trade.day.startsWith(year));
  const discoveryTrades = slice('2024');
  const confirmationTrades = slice('2025');
  const selected = goldMonthPasses(discoveryTrades, false);
  return {
    pattern,
    discovery: patternStats(discoveryTrades),
    confirmation: patternStats(confirmationTrades),
    selected,
    confirmed: selected && goldMonthPasses(confirmationTrades, true),
  };
});
const report = {
  experiment: 'candle-gold-month-2024-2025-v1',
  protocolSha256,
  tariff: 'trader-before-subscription',
  profitable: groups.filter((group) => group.confirmed).map((group) => group.pattern),
  groups,
};
writeFileSync('.trading/candle-gold-month-2024-2025-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({
  profitable: report.profitable,
  groups: groups.map((group) => ({ pattern: group.pattern, selected: group.selected, confirmed: group.confirmed, discovery: group.discovery })),
}, null, 2));
