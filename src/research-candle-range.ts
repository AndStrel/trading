import { readFileSync, writeFileSync } from 'node:fs';
import { digest } from './research/verified-candles.js';
import { patternPasses, patternStats, type PatternTrade } from './research/candle-pattern.js';
import { simulateRangePatterns, type RangeFamily } from './research/candle-range.js';
import type { DailyBar } from './research/weekly-trend.js';

const protocolSha256 = digest(readFileSync('docs/CANDLE_RANGE_2024_2025_V1.md'));
if (protocolSha256 !== 'e60172a913ab3a728e296f36380e9841a40083c464a9b9457d1a652db035b69d') throw new Error('Frozen range-pattern protocol changed');

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

const bars = Object.fromEntries(names.map((name) => {
  const [path, sha] = files[name];
  return [name, load(path, sha)];
})) as Record<typeof names[number], DailyBar[]>;

function familyReport(family: RangeFamily) {
  const trades = Object.fromEntries(names.map((name) => [name, simulateRangePatterns(bars[name]!, family)])) as Record<typeof names[number], PatternTrade[]>;
  const patterns = [...new Set(names.flatMap((name) => trades[name]!.map((trade) => trade.pattern)))].sort();
  const groups = patterns.map((pattern) => {
    const yearStats = (year: string) => Object.fromEntries(names.map((name) => {
      const sample = trades[name]!.filter((trade) => trade.pattern === pattern && trade.day.startsWith(year));
      return [name, patternStats(sample)];
    }));
    const discovery = yearStats('2024');
    const confirmation = yearStats('2025');
    const selected = names.every((name) => patternPasses(discovery[name]!, 20, false));
    const confirmed = selected && names.every((name) => patternPasses(confirmation[name]!, 20, true));
    return { pattern, discovery, confirmation, selected, confirmed };
  });
  return { family, confirmed: groups.filter((group) => group.confirmed).map((group) => group.pattern), groups };
}

const families = (['one-day', 'two-day'] as const).map(familyReport);
const report = {
  experiment: 'candle-range-2024-2025-v1',
  protocolSha256,
  tariff: 'trader-before-subscription',
  profitable: families.flatMap((family) => family.confirmed.map((pattern) => `${family.family}:${pattern}`)),
  families,
};
writeFileSync('.trading/candle-range-2024-2025-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({
  profitable: report.profitable,
  selected: families.map((family) => ({
    family: family.family,
    selected: family.groups.filter((group) => group.selected).map((group) => group.pattern),
    confirmed: family.confirmed,
  })),
}, null, 2));
