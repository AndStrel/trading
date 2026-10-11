import { readFileSync, writeFileSync } from 'node:fs';
import { digest } from './research/verified-candles.js';
import { patternStats } from './research/candle-pattern.js';
import { pairMonthPasses, simulatePairMonth, type PairSide } from './research/candle-pair-month.js';
import type { DailyBar } from './research/weekly-trend.js';

const protocolSha256 = digest(readFileSync('docs/CANDLE_PAIR_MONTH_2024_2025_V1.md'));
if (protocolSha256 !== 'dc180d39d07b7d70161ee2439ce4132f545975d029f7cca4d21dc94cdb94a7b7') throw new Error('Frozen pair-month protocol changed');

const files = {
  SBER: ['.trading/sber-daily-2015-2025.json', '07fa1ee1facc96812b196a910525238e1257113906d7abc2187a16fc141093ab'],
  SBERP: ['.trading/sberp-daily-2015-2025.json', '099fbd5eae7e056a2aea986048792175a6bc5139264ffa65d037b908cd28631e'],
} as const;

function load(path: string, sha: string): DailyBar[] {
  const source = JSON.parse(readFileSync(path, 'utf8')) as { rowsSha256: string; rows: DailyBar[] };
  if (source.rowsSha256 !== sha) throw new Error(`Frozen source changed: ${path}`);
  return source.rows;
}

const books = Object.fromEntries(Object.entries(files).map(([name, [path, sha]]) => [name, load(path, sha)])) as Record<string, DailyBar[]>;
const groups = (['leader', 'laggard'] as const satisfies readonly PairSide[]).map((side) => {
  const trades = simulatePairMonth(books, side);
  const slice = (year: string) => trades.filter((trade) => trade.day.startsWith(year)).map((trade) => ({ ...trade, pattern: side }));
  const discoveryTrades = slice('2024');
  const confirmationTrades = slice('2025');
  const selected = pairMonthPasses(discoveryTrades, false);
  return {
    side,
    discovery: patternStats(discoveryTrades),
    confirmation: patternStats(confirmationTrades),
    selected,
    confirmed: selected && pairMonthPasses(confirmationTrades, true),
  };
});
const report = {
  experiment: 'candle-pair-month-2024-2025-v1',
  protocolSha256,
  tariff: 'trader-before-subscription',
  profitable: groups.filter((group) => group.confirmed).map((group) => group.side),
  groups,
};
writeFileSync('.trading/candle-pair-month-2024-2025-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({
  profitable: report.profitable,
  groups: groups.map((group) => ({ side: group.side, selected: group.selected, confirmed: group.confirmed, discovery: group.discovery })),
}, null, 2));
