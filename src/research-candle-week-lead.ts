import { readFileSync, writeFileSync } from 'node:fs';
import { digest } from './research/verified-candles.js';
import { patternStats } from './research/candle-pattern.js';
import { simulateWeekLead, weekLeadPasses, type WeekLeadSide } from './research/candle-week-lead.js';
import type { DailyBar } from './research/weekly-trend.js';

const protocolSha256 = digest(readFileSync('docs/CANDLE_WEEK_LEAD_2024_2025_V1.md'));
if (protocolSha256 !== '3e0ac8f8c0b47e87f7ea9401db1c279176c9378ad00050e87de1f3ce2058b87d') throw new Error('Frozen week-lead protocol changed');

const files = {
  SBER: ['.trading/sber-daily-2015-2025.json', '07fa1ee1facc96812b196a910525238e1257113906d7abc2187a16fc141093ab'],
  GAZP: ['.trading/gazp-daily-2015-2025.json', 'd0705203ae7629cc0b919f5b2a6da8b5be333972d8c81aba8bc6d1b13923c261'],
  SBMX: ['.trading/sbmx-daily-2021-2025.json', '31e0501946b7e733d35f4138d196d3e191e1513e9ebfa385bce68a87f901f6ed'],
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
  return {
    side,
    discovery: patternStats(discoveryTrades),
    confirmation: patternStats(confirmationTrades),
    selected: weekLeadPasses(discoveryTrades, false),
    confirmed: weekLeadPasses(discoveryTrades, false) && weekLeadPasses(confirmationTrades, true),
  };
});
const report = {
  experiment: 'candle-week-lead-2024-2025-v1',
  protocolSha256,
  tariff: 'trader-before-subscription',
  profitable: groups.filter((group) => group.confirmed).map((group) => group.side),
  groups,
};
writeFileSync('.trading/candle-week-lead-2024-2025-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({
  profitable: report.profitable,
  groups: groups.map((group) => ({ side: group.side, selected: group.selected, confirmed: group.confirmed, discovery: group.discovery })),
}, null, 2));
