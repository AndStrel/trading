import { readFileSync, writeFileSync } from 'node:fs';
import { digest } from './research/verified-candles.js';
import { patternStats } from './research/candle-pattern.js';
import { prefWeekPasses, simulatePrefWeek } from './research/candle-pref-week.js';
import type { DailyBar } from './research/weekly-trend.js';

const protocolSha256 = digest(readFileSync('docs/CANDLE_PREF_WEEK_2024_2025_V1.md'));
if (protocolSha256 !== '5603bce47f99ee5f7ca365e305fd7f086b254b6e93bf6b6d74d9059d65f6a32d') throw new Error('Frozen pref-week protocol changed');

const files = {
  SBERP: ['.trading/sberp-daily-2015-2025.json', '099fbd5eae7e056a2aea986048792175a6bc5139264ffa65d037b908cd28631e'],
  SBER: ['.trading/sber-daily-2015-2025.json', '07fa1ee1facc96812b196a910525238e1257113906d7abc2187a16fc141093ab'],
} as const;

function load(path: string, sha: string): DailyBar[] {
  const source = JSON.parse(readFileSync(path, 'utf8')) as { rowsSha256: string; rows: DailyBar[] };
  if (source.rowsSha256 !== sha) throw new Error(`Frozen source changed: ${path}`);
  return source.rows;
}

const [signalPath, signalSha] = files.SBERP;
const [targetPath, targetSha] = files.SBER;
const trades = simulatePrefWeek(load(signalPath, signalSha), load(targetPath, targetSha));
const groups = (['U', 'D'] as const).map((pattern) => {
  const slice = (year: string) => trades.filter((trade) => trade.pattern === pattern && trade.day.startsWith(year));
  const discoveryTrades = slice('2024');
  const confirmationTrades = slice('2025');
  const selected = prefWeekPasses(discoveryTrades, false);
  return {
    pattern,
    discovery: patternStats(discoveryTrades),
    confirmation: patternStats(confirmationTrades),
    selected,
    confirmed: selected && prefWeekPasses(confirmationTrades, true),
  };
});
const report = {
  experiment: 'candle-pref-week-2024-2025-v1',
  protocolSha256,
  tariff: 'trader-before-subscription',
  profitable: groups.filter((group) => group.confirmed).map((group) => group.pattern),
  groups,
};
writeFileSync('.trading/candle-pref-week-2024-2025-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({
  profitable: report.profitable,
  groups: groups.map((group) => ({ pattern: group.pattern, selected: group.selected, confirmed: group.confirmed, discovery: group.discovery })),
}, null, 2));
