import { readFileSync, writeFileSync } from 'node:fs';
import { digest } from './research/verified-candles.js';
import { patternStats } from './research/candle-pattern.js';
import { prefSpreadPasses, simulatePrefSpread } from './research/candle-pref-spread.js';
import type { DailyBar } from './research/weekly-trend.js';

const protocolSha256 = digest(readFileSync('docs/CANDLE_PREF_SPREAD_2024_2025_V1.md'));
if (protocolSha256 !== 'b72e33b0fd27455d500a6a105b0142154f34445bba5bd737d9ac4c8c0cf384f3') throw new Error('Frozen pref-spread protocol changed');

const files = {
  SBERP: ['.trading/sberp-daily-2015-2025.json', '099fbd5eae7e056a2aea986048792175a6bc5139264ffa65d037b908cd28631e'],
  SBER: ['.trading/sber-daily-2015-2025.json', '07fa1ee1facc96812b196a910525238e1257113906d7abc2187a16fc141093ab'],
} as const;

function load(path: string, sha: string): DailyBar[] {
  const source = JSON.parse(readFileSync(path, 'utf8')) as { rowsSha256: string; rows: DailyBar[] };
  if (source.rowsSha256 !== sha) throw new Error(`Frozen source changed: ${path}`);
  return source.rows;
}

const [preferredPath, preferredSha] = files.SBERP;
const [commonPath, commonSha] = files.SBER;
const trades = simulatePrefSpread(load(preferredPath, preferredSha), load(commonPath, commonSha));
const groups = (['P', 'C'] as const).map((pattern) => {
  const slice = (year: string) => trades.filter((trade) => trade.pattern === pattern && trade.day.startsWith(year));
  const discoveryTrades = slice('2024');
  const confirmationTrades = slice('2025');
  const selected = prefSpreadPasses(discoveryTrades, false);
  return {
    pattern,
    discovery: patternStats(discoveryTrades),
    confirmation: patternStats(confirmationTrades),
    selected,
    confirmed: selected && prefSpreadPasses(confirmationTrades, true),
  };
});
const report = {
  experiment: 'candle-pref-spread-2024-2025-v1',
  protocolSha256,
  tariff: 'trader-before-subscription',
  profitable: groups.filter((group) => group.confirmed).map((group) => group.pattern),
  groups,
};
writeFileSync('.trading/candle-pref-spread-2024-2025-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({
  profitable: report.profitable,
  groups: groups.map((group) => ({ pattern: group.pattern, selected: group.selected, confirmed: group.confirmed, discovery: group.discovery })),
}, null, 2));
