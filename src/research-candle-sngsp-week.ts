import { readFileSync, writeFileSync } from 'node:fs';
import { digest } from './research/verified-candles.js';
import { patternStats } from './research/candle-pattern.js';
import { simulateSngspWeek, sngspWeekPasses } from './research/candle-sngsp-week.js';
import type { DailyBar } from './research/weekly-trend.js';

const protocolSha256 = digest(readFileSync('docs/CANDLE_SNGSP_WEEK_2024_2025_V1.md'));
if (protocolSha256 !== '4392e17876d18a9ca06241054ecdce819f8df68921ea9968c8d3af1d6de7079f') throw new Error('Frozen sngsp-week protocol changed');

const files = {
  SNGSP: ['.trading/sngsp-daily-2015-2025.json', 'bca856ce5d4b266bf03acfd4e324d601ec983ef8b1e0cef8ea696e5e53c2e07a'],
  SNGS: ['.trading/sngs-daily-2015-2025.json', '58c3ab8293cc50966e2fb95243e74a6a219bc177449150c8067c13f33f9a9418'],
} as const;

function load(path: string, sha: string): DailyBar[] {
  const source = JSON.parse(readFileSync(path, 'utf8')) as { rowsSha256: string; rows: DailyBar[] };
  if (source.rowsSha256 !== sha) throw new Error(`Frozen source changed: ${path}`);
  return source.rows;
}

const [signalPath, signalSha] = files.SNGSP;
const [targetPath, targetSha] = files.SNGS;
const trades = simulateSngspWeek(load(signalPath, signalSha), load(targetPath, targetSha));
const groups = (['U', 'D'] as const).map((pattern) => {
  const slice = (year: string) => trades.filter((trade) => trade.pattern === pattern && trade.day.startsWith(year));
  const discoveryTrades = slice('2024');
  const confirmationTrades = slice('2025');
  const selected = sngspWeekPasses(discoveryTrades, false);
  return {
    pattern,
    discovery: patternStats(discoveryTrades),
    confirmation: patternStats(confirmationTrades),
    selected,
    confirmed: selected && sngspWeekPasses(confirmationTrades, true),
  };
});
const report = {
  experiment: 'candle-sngsp-week-2024-2025-v1',
  protocolSha256,
  tariff: 'trader-before-subscription',
  profitable: groups.filter((group) => group.confirmed).map((group) => group.pattern),
  groups,
};
writeFileSync('.trading/candle-sngsp-week-2024-2025-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({
  profitable: report.profitable,
  groups: groups.map((group) => ({ pattern: group.pattern, selected: group.selected, confirmed: group.confirmed, discovery: group.discovery })),
}, null, 2));
