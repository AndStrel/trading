import { readFileSync, writeFileSync } from 'node:fs';
import { digest } from './research/verified-candles.js';
import { patternStats, type PatternTrade } from './research/candle-pattern.js';
import { simulateWeekFlip, weekFlipPasses } from './research/candle-week-flip.js';
import type { DailyBar } from './research/weekly-trend.js';

const protocolSha256 = digest(readFileSync('docs/CANDLE_WEEK_FLIP_2024_2025_V1.md'));
if (protocolSha256 !== '8025de966a5e31d466f3f7972de61ab4d16e23ba68f471d56dc372ef83286fc7') throw new Error('Frozen week-flip protocol changed');

const files = {
  SBER: ['.trading/sber-daily-2015-2025.json', '07fa1ee1facc96812b196a910525238e1257113906d7abc2187a16fc141093ab'],
  GAZP: ['.trading/gazp-daily-2015-2025.json', 'd0705203ae7629cc0b919f5b2a6da8b5be333972d8c81aba8bc6d1b13923c261'],
  SBMX: ['.trading/sbmx-daily-2021-2025.json', '31e0501946b7e733d35f4138d196d3e191e1513e9ebfa385bce68a87f901f6ed'],
} as const;
const names = ['SBER', 'GAZP', 'SBMX'] as const;

function load(path: string, sha: string): DailyBar[] {
  const source = JSON.parse(readFileSync(path, 'utf8')) as { rowsSha256: string; rows: DailyBar[] };
  if (source.rowsSha256 !== sha) throw new Error(`Frozen source changed: ${path}`);
  return source.rows;
}

const trades = Object.fromEntries(names.map((name) => {
  const [path, sha] = files[name];
  return [name, simulateWeekFlip(load(path, sha))];
})) as Record<typeof names[number], PatternTrade[]>;

const groups = (['UD', 'DU'] as const).map((pattern) => {
  const slice = (name: typeof names[number], year: string) => trades[name].filter((trade) => trade.pattern === pattern && trade.day.startsWith(year));
  const discovery = Object.fromEntries(names.map((name) => [name, patternStats(slice(name, '2024'))]));
  const confirmation = Object.fromEntries(names.map((name) => [name, patternStats(slice(name, '2025'))]));
  const selected = names.every((name) => weekFlipPasses(slice(name, '2024'), false));
  const confirmed = selected && names.every((name) => weekFlipPasses(slice(name, '2025'), true));
  return { pattern, discovery, confirmation, selected, confirmed };
});
const report = {
  experiment: 'candle-week-flip-2024-2025-v1',
  protocolSha256,
  tariff: 'trader-before-subscription',
  profitable: groups.filter((group) => group.confirmed).map((group) => group.pattern),
  groups,
};
writeFileSync('.trading/candle-week-flip-2024-2025-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({
  profitable: report.profitable,
  groups: groups.map((group) => ({ pattern: group.pattern, selected: group.selected, confirmed: group.confirmed, discovery: group.discovery })),
}, null, 2));
