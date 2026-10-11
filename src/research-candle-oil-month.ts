import { readFileSync, writeFileSync } from 'node:fs';
import { digest } from './research/verified-candles.js';
import { patternStats } from './research/candle-pattern.js';
import { oilMonthPasses, simulateOilMonth } from './research/candle-oil-month.js';
import type { DailyBar } from './research/weekly-trend.js';

const protocolSha256 = digest(readFileSync('docs/CANDLE_OIL_MONTH_2024_2025_V1.md'));
if (protocolSha256 !== 'b2778286f0ceea6ef9f63d7ce5082ea8f915a241c023b2bc395e351e0efe6bfe') throw new Error('Frozen oil-month protocol changed');

const files = {
  LKOH: ['.trading/lkoh-daily-2021-2025.json', 'c6ac11b117d326a4272da5349d0f6778146af80840d63686e18889d4f96f512a'],
  ROSN: ['.trading/rosn-daily-2021-2025.json', '68f0731e9cf77b4add121411753e2d6805f081a8dec6b8d157cb865e1d274d06'],
} as const;

function load(path: string, sha: string): DailyBar[] {
  const source = JSON.parse(readFileSync(path, 'utf8')) as { rowsSha256: string; rows: DailyBar[] };
  if (source.rowsSha256 !== sha) throw new Error(`Frozen source changed: ${path}`);
  return source.rows;
}

const [signalPath, signalSha] = files.LKOH;
const [targetPath, targetSha] = files.ROSN;
const trades = simulateOilMonth(load(signalPath, signalSha), load(targetPath, targetSha));
const groups = (['U', 'D'] as const).map((pattern) => {
  const slice = (year: string) => trades.filter((trade) => trade.pattern === pattern && trade.day.startsWith(year));
  const discoveryTrades = slice('2024');
  const confirmationTrades = slice('2025');
  const selected = oilMonthPasses(discoveryTrades, false);
  return {
    pattern,
    discovery: patternStats(discoveryTrades),
    confirmation: patternStats(confirmationTrades),
    selected,
    confirmed: selected && oilMonthPasses(confirmationTrades, true),
  };
});
const report = {
  experiment: 'candle-oil-month-2024-2025-v1',
  protocolSha256,
  tariff: 'trader-before-subscription',
  profitable: groups.filter((group) => group.confirmed).map((group) => group.pattern),
  groups,
};
writeFileSync('.trading/candle-oil-month-2024-2025-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({
  profitable: report.profitable,
  groups: groups.map((group) => ({ pattern: group.pattern, selected: group.selected, confirmed: group.confirmed, discovery: group.discovery })),
}, null, 2));
