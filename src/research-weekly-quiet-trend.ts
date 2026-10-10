import { readFileSync, writeFileSync } from 'node:fs';
import { digest } from './research/verified-candles.js';
import { simulateWeeklyQuietTrend, quietStats } from './research/weekly-quiet-trend.js';
import type { DailyBar } from './research/weekly-trend.js';

const protocolSha256 = digest(readFileSync('docs/WEEKLY_QUIET_TREND_V1.md'));
if (protocolSha256 !== '0f0b68db313b6867d93d5e09718e11666885ee2a7a1d9b475f0756453988de8a') {
  throw new Error('Frozen weekly quiet-trend protocol changed');
}
const source = JSON.parse(readFileSync('.trading/sber-daily-2015-2025.json', 'utf8')) as {
  rowsSha256: string; rows: DailyBar[];
};
if (source.rowsSha256 !== '07fa1ee1facc96812b196a910525238e1257113906d7abc2187a16fc141093ab' ||
  source.rows.length !== 2827 || digest(JSON.stringify(source.rows)) !== source.rowsSha256) {
  throw new Error('Frozen daily source changed');
}
const groups = [
  { name: '2016-2019', from: 2016, to: 2019 },
  { name: '2020-2022', from: 2020, to: 2022 },
  { name: '2023-2025', from: 2023, to: 2025 },
];
const comparisons = (['quiet-trend', 'always-long'] as const).map((mode) => {
  const result = simulateWeeklyQuietTrend(source.rows, mode);
  const periods = groups.map((group) => ({ group: group.name, ...quietStats(result.trades.filter((trade) => {
    const year = Number(trade.entryDay.slice(0, 4));
    return year >= group.from && year <= group.to;
  })) }));
  const years = Array.from({ length: 10 }, (_, index) => 2016 + index).map((year) => ({ year,
    ...quietStats(result.trades.filter((trade) => trade.entryDay.startsWith(String(year)))) }));
  const combined = quietStats(result.trades);
  const reasons: string[] = [];
  if (combined.trades < 100 || combined.weeks < 50) reasons.push('insufficient-sample');
  if (combined.winRate === null || combined.winRate < 0.51 || combined.meanNetPct === null ||
    combined.meanNetPct <= 0 || combined.profitFactor === null || combined.profitFactor <= 1 ||
    combined.withoutBestFiveSumPct <= 0) reasons.push('failed-combined-gate');
  if (periods.some((period) => period.meanNetPct === null || period.meanNetPct <= 0 ||
    period.winRate === null || period.winRate < 0.51)) reasons.push('failed-period-gate');
  if (years.some((year) => year.trades > 0 && (year.meanNetPct === null || year.meanNetPct <= 0))) {
    reasons.push('failed-year-gate');
  }
  return { ...result, combined, periods, years,
    status: reasons.length ? 'rejected-in-discovery' : 'requires-independent-test-not-tradeable', reasons };
});
const report = { experiment: 'weekly-quiet-trend-v1', protocolSha256, sourceSha256: source.rowsSha256,
  codeSha256: digest(Buffer.concat(['src/research-weekly-quiet-trend.ts',
    'src/research/weekly-quiet-trend.ts', 'src/research/trading-costs.ts'].map((path) => readFileSync(path)))),
  comparisons };
writeFileSync('.trading/weekly-quiet-trend-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ ...report, comparisons: comparisons.map(({ trades, decisions, ...rest }) => ({
  ...rest, tradeCount: trades.length, decisionCount: decisions.length })) }, null, 2));
