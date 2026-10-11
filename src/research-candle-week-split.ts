import { readFileSync, writeFileSync } from 'node:fs';
import { digest } from './research/verified-candles.js';
import { patternStats } from './research/candle-pattern.js';
import { simulateWeekSplit, weekSplitPasses } from './research/candle-week-split.js';
import type { DailyBar } from './research/weekly-trend.js';

const protocolSha256 = digest(readFileSync('docs/CANDLE_WEEK_SPLIT_2024_2025_V1.md'));
if (protocolSha256 !== 'b268b6e6080397259ff66249ec2f9acbd98cb377e023d4c291885dd518de166d') throw new Error('Frozen week-split protocol changed');

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

const [sberPath, sberSha] = files.SBER;
const [gazpPath, gazpSha] = files.GAZP;
const [sbmxPath, sbmxSha] = files.SBMX;
const trades = simulateWeekSplit(load(sberPath, sberSha), load(gazpPath, gazpSha), load(sbmxPath, sbmxSha));
const groups = (['UD', 'DU'] as const).map((pattern) => {
  const slice = (year: string) => trades.filter((trade) => trade.pattern === pattern && trade.day.startsWith(year));
  const discoveryTrades = slice('2024');
  const confirmationTrades = slice('2025');
  const selected = weekSplitPasses(discoveryTrades, false);
  return {
    pattern,
    discovery: patternStats(discoveryTrades),
    confirmation: patternStats(confirmationTrades),
    selected,
    confirmed: selected && weekSplitPasses(confirmationTrades, true),
  };
});
const report = {
  experiment: 'candle-week-split-2024-2025-v1',
  protocolSha256,
  tariff: 'trader-before-subscription',
  profitable: groups.filter((group) => group.confirmed).map((group) => group.pattern),
  groups,
};
writeFileSync('.trading/candle-week-split-2024-2025-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({
  profitable: report.profitable,
  groups: groups.map((group) => ({ pattern: group.pattern, selected: group.selected, confirmed: group.confirmed, discovery: group.discovery })),
}, null, 2));
