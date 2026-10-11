import { readFileSync, writeFileSync } from 'node:fs';
import { digest } from './research/verified-candles.js';
import { patternStats } from './research/candle-pattern.js';
import { oilWeekPasses, simulateOilWeek } from './research/candle-oil-week.js';
import type { DailyBar } from './research/weekly-trend.js';

const protocolSha256 = digest(readFileSync('docs/CANDLE_OIL_WEEK_2024_2025_V1.md'));
if (protocolSha256 !== 'fa5ba0a4be6d4b60d8be5cd4c6af1d0c22d3e8526a4bb5c244d50b5bc3014110') throw new Error('Frozen oil-week protocol changed');

const files = {
  SNGS: ['.trading/sngs-daily-2015-2025.json', '58c3ab8293cc50966e2fb95243e74a6a219bc177449150c8067c13f33f9a9418'],
  GAZP: ['.trading/gazp-daily-2015-2025.json', 'd0705203ae7629cc0b919f5b2a6da8b5be333972d8c81aba8bc6d1b13923c261'],
} as const;

function load(path: string, sha: string): DailyBar[] {
  const source = JSON.parse(readFileSync(path, 'utf8')) as { rowsSha256: string; rows: DailyBar[] };
  if (source.rowsSha256 !== sha) throw new Error(`Frozen source changed: ${path}`);
  return source.rows;
}

const [signalPath, signalSha] = files.SNGS;
const [targetPath, targetSha] = files.GAZP;
const trades = simulateOilWeek(load(signalPath, signalSha), load(targetPath, targetSha));
const groups = (['U', 'D'] as const).map((pattern) => {
  const slice = (year: string) => trades.filter((trade) => trade.pattern === pattern && trade.day.startsWith(year));
  const discoveryTrades = slice('2024');
  const confirmationTrades = slice('2025');
  const selected = oilWeekPasses(discoveryTrades, false);
  return {
    pattern,
    discovery: patternStats(discoveryTrades),
    confirmation: patternStats(confirmationTrades),
    selected,
    confirmed: selected && oilWeekPasses(confirmationTrades, true),
  };
});
const report = {
  experiment: 'candle-oil-week-2024-2025-v1',
  protocolSha256,
  tariff: 'trader-before-subscription',
  profitable: groups.filter((group) => group.confirmed).map((group) => group.pattern),
  groups,
};
writeFileSync('.trading/candle-oil-week-2024-2025-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({
  profitable: report.profitable,
  groups: groups.map((group) => ({ pattern: group.pattern, selected: group.selected, confirmed: group.confirmed, discovery: group.discovery })),
}, null, 2));
