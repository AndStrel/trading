import { readFileSync, writeFileSync } from 'node:fs';
import { digest } from './research/verified-candles.js';
import { patternPasses, patternStats, simulatePatterns, type PatternFamily, type PatternTrade } from './research/candle-pattern.js';
import type { DailyBar } from './research/weekly-trend.js';

const protocolSha256 = digest(readFileSync('docs/CANDLE_PATTERN_2024_2025_V1.md'));
if (protocolSha256 !== '3988216c8fd683c1c6b2a3d8b00b780baf73dccdfdfd933a95c5ec522d655473') throw new Error('Frozen candle-pattern protocol changed');

const files = {
  SBER: ['.trading/sber-daily-2015-2025.json', '07fa1ee1facc96812b196a910525238e1257113906d7abc2187a16fc141093ab'],
  GAZP: ['.trading/gazp-daily-2015-2025.json', 'd0705203ae7629cc0b919f5b2a6da8b5be333972d8c81aba8bc6d1b13923c261'],
  SBMX: ['.trading/sbmx-daily-2021-2025.json', '31e0501946b7e733d35f4138d196d3e191e1513e9ebfa385bce68a87f901f6ed'],
} as const;
const names = ['SBER', 'GAZP', 'SBMX'] as const;
type Name = typeof names[number];

function load(path: string, sha: string): DailyBar[] {
  const source = JSON.parse(readFileSync(path, 'utf8')) as { rowsSha256: string; rows: DailyBar[] };
  if (source.rowsSha256 !== sha) throw new Error(`Frozen source changed: ${path}`);
  return source.rows;
}

const bars = Object.fromEntries(names.map((name) => {
  const [path, sha] = files[name];
  return [name, load(path, sha)];
})) as Record<Name, DailyBar[]>;

function byPattern(trades: PatternTrade[], year: string) {
  const groups = new Map<string, PatternTrade[]>();
  for (const trade of trades) {
    if (!trade.day.startsWith(year)) continue;
    groups.set(trade.pattern, [...(groups.get(trade.pattern) ?? []), trade]);
  }
  return groups;
}

function familyReport(family: PatternFamily) {
  const trades = Object.fromEntries(names.map((name) => [name, simulatePatterns(bars[name], family)])) as Record<Name, PatternTrade[]>;
  const patterns = [...new Set(names.flatMap((name) => trades[name].map((trade) => trade.pattern)))].sort();
  const groups = patterns.map((pattern) => {
    const discovery = Object.fromEntries(names.map((name) => [name, patternStats((byPattern(trades[name], '2024').get(pattern) ?? []))]));
    const confirmation = Object.fromEntries(names.map((name) => [name, patternStats((byPattern(trades[name], '2025').get(pattern) ?? []))]));
    const selected = names.every((name) => patternPasses(discovery[name]!, 20, false));
    const confirmed = selected && names.every((name) => patternPasses(confirmation[name]!, 20, true));
    return { pattern, discovery, confirmation, selected, confirmed };
  });
  return { family, groups, confirmed: groups.filter((group) => group.confirmed).map((group) => group.pattern) };
}

const families = (['body', 'step'] as const).map(familyReport);
const report = {
  experiment: 'candle-pattern-2024-2025-v1',
  protocolSha256,
  tariff: 'trader-before-subscription',
  families,
  profitable: families.flatMap((family) => family.confirmed.map((pattern) => `${family.family}:${pattern}`)),
};
writeFileSync('.trading/candle-pattern-2024-2025-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({
  profitable: report.profitable,
  families: families.map((family) => ({
    family: family.family,
    selected: family.groups.filter((group) => group.selected).map((group) => group.pattern),
    confirmed: family.confirmed,
    groups: family.groups.map((group) => ({
      pattern: group.pattern,
      selected: group.selected,
      confirmed: group.confirmed,
      discovery: Object.fromEntries(names.map((name) => [name, {
        trades: group.discovery[name]!.trades,
        winRate: group.discovery[name]!.winRate,
        meanNetPct: group.discovery[name]!.meanNetPct,
      }])),
      confirmation: Object.fromEntries(names.map((name) => [name, {
        trades: group.confirmation[name]!.trades,
        winRate: group.confirmation[name]!.winRate,
        meanNetPct: group.confirmation[name]!.meanNetPct,
      }])),
    })),
  })),
}, null, 2));
