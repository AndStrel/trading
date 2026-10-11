import { readFileSync, writeFileSync } from 'node:fs';
import { digest } from './research/verified-candles.js';
import { patternStats } from './research/candle-pattern.js';
import { simulateWeekLead, weekLeadPasses, type WeekLeadSide } from './research/candle-week-lead.js';
import type { DailyBar } from './research/weekly-trend.js';

const protocolSha256 = digest(readFileSync('docs/CANDLE_RESOURCE_WEEK_2024_2025_V1.md'));
if (protocolSha256 !== 'f64d4fb2e511f064082566e2d45b74c73060f8d93ff162467da5932571ae2da2') throw new Error('Frozen resource-week protocol changed');

const files = {
  LKOH: ['.trading/lkoh-daily-2021-2025.json', 'c6ac11b117d326a4272da5349d0f6778146af80840d63686e18889d4f96f512a'],
  ROSN: ['.trading/rosn-daily-2021-2025.json', '68f0731e9cf77b4add121411753e2d6805f081a8dec6b8d157cb865e1d274d06'],
  PLZL: ['.trading/plzl-daily-2022-2025.json', '001bec15575548ca470b5ae3c4e529d6990583f3fc9426fb9369626422483d4c'],
} as const;

function load(path: string, sha: string): DailyBar[] {
  const source = JSON.parse(readFileSync(path, 'utf8')) as { rowsSha256: string; rows: DailyBar[] };
  if (source.rowsSha256 !== sha) throw new Error(`Frozen source changed: ${path}`);
  return source.rows;
}

const books = Object.fromEntries(Object.entries(files).map(([name, [path, sha]]) => [name, load(path, sha)])) as Record<string, DailyBar[]>;
const sides: WeekLeadSide[] = ['leader', 'laggard'];
const groups = sides.map((side) => {
  const trades = simulateWeekLead(books, side);
  const slice = (year: string) => trades.filter((trade) => trade.day.startsWith(year)).map((trade) => ({ ...trade, pattern: side }));
  const discoveryTrades = slice('2024');
  const confirmationTrades = slice('2025');
  const selected = weekLeadPasses(discoveryTrades, false);
  return {
    side,
    discovery: patternStats(discoveryTrades),
    confirmation: patternStats(confirmationTrades),
    selected,
    confirmed: selected && weekLeadPasses(confirmationTrades, true),
  };
});
const report = {
  experiment: 'candle-resource-week-2024-2025-v1',
  protocolSha256,
  tariff: 'trader-before-subscription',
  profitable: groups.filter((group) => group.confirmed).map((group) => group.side),
  groups,
};
writeFileSync('.trading/candle-resource-week-2024-2025-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({
  profitable: report.profitable,
  groups: groups.map((group) => ({ side: group.side, selected: group.selected, confirmed: group.confirmed, discovery: group.discovery })),
}, null, 2));
