import { readFileSync, writeFileSync } from 'node:fs';
import { digest } from './research/verified-candles.js';
import { simulateWeeklyTrend, weeklyTrendStats, type DailyBar } from './research/weekly-trend.js';

const protocolSha256 = digest(readFileSync('docs/GAZP_WEEKLY_TREND_CONTROL_V1.md'));
if (protocolSha256 !== '13af8977c96c0b9ba608ab975050b3b144508a0d0df0ac427a56026e788563a1') {
  throw new Error('Frozen GAZP protocol changed');
}
const source = JSON.parse(readFileSync('.trading/gazp-daily-2015-2025.json', 'utf8')) as {
  rowsSha256: string; rows: DailyBar[]; coverage: { year: number; count: number; sha256: string }[];
};
if (source.rowsSha256 !== 'd0705203ae7629cc0b919f5b2a6da8b5be333972d8c81aba8bc6d1b13923c261' ||
  source.rows.length !== 2827 || source.coverage.length !== 11 ||
  digest(JSON.stringify(source.rows)) !== source.rowsSha256) throw new Error('Frozen GAZP source changed');
const groups = [
  { name: '2016-2019', from: 2016, to: 2019 },
  { name: '2020-2022', from: 2020, to: 2022 },
  { name: '2023-2025', from: 2023, to: 2025 },
];
const comparisons = (['trend', 'always-long'] as const).map((mode) => {
  const result = simulateWeeklyTrend(source.rows, mode);
  const combined = weeklyTrendStats(result.trades);
  const periods = groups.map((group) => ({ group: group.name,
    ...weeklyTrendStats(result.trades.filter((trade) => {
      const year = Number(trade.entryDay.slice(0, 4));
      return year >= group.from && year <= group.to;
    })) }));
  const years = Array.from({ length: 10 }, (_, index) => 2016 + index).map((year) => ({ year,
    ...weeklyTrendStats(result.trades.filter((trade) => trade.entryDay.startsWith(String(year)))) }));
  const reasons: string[] = [];
  if (combined.trades < 100 || combined.entryWeeks < 50) reasons.push('insufficient-sample');
  if (combined.winRate === null || combined.winRate < 0.51 || combined.meanNetPct === null ||
    combined.meanNetPct <= 0 || combined.profitFactor === null || combined.profitFactor <= 1 ||
    combined.withoutBestFiveSumPct <= 0) reasons.push('failed-combined-gate');
  if (periods.some((period) => period.trades > 0 && (period.winRate === null || period.winRate < 0.51 ||
    period.meanNetPct === null || period.meanNetPct <= 0))) reasons.push('failed-period-gate');
  if (years.some((year) => year.trades > 0 && (year.meanNetPct === null || year.meanNetPct <= 0))) {
    reasons.push('failed-year-gate');
  }
  if (years.some((year) => year.trades === 0)) reasons.push('unobserved-year');
  return { ...result, combined, periods, years,
    status: reasons.length ? 'rejected-in-discovery' : 'requires-independent-test-not-tradeable', reasons };
});
const report = { experiment: 'gazp-weekly-trend-control-v1', protocolSha256,
  sourceSha256: source.rowsSha256,
  codeSha256: digest(Buffer.concat(['src/research-gazp-weekly-trend.ts',
    'src/research/weekly-trend.ts', 'src/research/trading-costs.ts'].map((path) => readFileSync(path)))),
  coverage: source.coverage, comparisons };
writeFileSync('.trading/gazp-weekly-trend-control-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ ...report, comparisons: comparisons.map(({ trades, decisions, pending, ...rest }) => ({
  ...rest, tradeCount: trades.length, decisionCount: decisions.length, pendingCount: pending.length })) }, null, 2));
