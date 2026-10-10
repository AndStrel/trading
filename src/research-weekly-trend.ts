import { readFileSync, writeFileSync } from 'node:fs';
import { digest } from './research/verified-candles.js';
import { simulateWeeklyTrend, weeklyTrendStats, type DailyBar } from './research/weekly-trend.js';

const protocolSha256 = digest(readFileSync('docs/WEEKLY_TREND_V1.md'));
if (protocolSha256 !== 'd8d9419e3647e415f52712f326bf6c37c5df5f821793468c3c0bcebd88343ba7') throw new Error('Frozen weekly trend protocol changed');
const source = JSON.parse(readFileSync('.trading/sber-daily-2015-2025.json', 'utf8')) as {
  rowsSha256: string; rows: DailyBar[]; coverage: { year: number; count: number; sha256: string }[];
};
if (source.rowsSha256 !== '07fa1ee1facc96812b196a910525238e1257113906d7abc2187a16fc141093ab' ||
  source.coverage.length !== 11 || source.rows.length !== 2827 ||
  digest(JSON.stringify(source.rows)) !== source.rowsSha256) throw new Error('Frozen daily source changed');
const groups = [
  { name: '2016-2019', from: 2016, to: 2019 },
  { name: '2020-2022', from: 2020, to: 2022 },
  { name: '2023-2025', from: 2023, to: 2025 },
];
const comparisons = (['trend', 'always-long'] as const).map((mode) => {
  const result = simulateWeeklyTrend(source.rows, mode);
  const periods = groups.map((group) => ({ group: group.name,
    ...weeklyTrendStats(result.trades.filter((t) => Number(t.entryDay.slice(0, 4)) >= group.from &&
      Number(t.entryDay.slice(0, 4)) <= group.to)) }));
  const years = Array.from({ length: 10 }, (_, i) => 2016 + i).map((year) => ({ year,
    ...weeklyTrendStats(result.trades.filter((t) => t.entryDay.startsWith(String(year)))) }));
  const combined = weeklyTrendStats(result.trades);
  const reasons: string[] = [];
  if (combined.trades < 100 || combined.entryWeeks < 50) reasons.push('insufficient-trades-or-weeks');
  if (combined.winRate === null || combined.winRate < 0.51 || combined.meanNetPct === null ||
    combined.meanNetPct <= 0 || combined.profitFactor === null || combined.profitFactor <= 1 ||
    combined.withoutBestFiveSumPct <= 0) reasons.push('failed-combined-gate');
  if (periods.filter((p) => p.group !== '2016-2019').some((p) => p.winRate === null || p.winRate < 0.51 ||
    p.meanNetPct === null || p.meanNetPct <= 0 || p.profitFactor === null || p.profitFactor <= 1)) reasons.push('failed-late-period-gate');
  return { ...result, status: reasons.length ? 'rejected-in-discovery' : 'requires-independent-test-not-tradeable',
    reasons, combined, periods, years };
});
const report = { experiment: 'weekly-trend-v1', protocolSha256, sourceSha256: source.rowsSha256,
  codeSha256: digest(Buffer.concat(['src/research-weekly-trend.ts', 'src/research/weekly-trend.ts',
    'src/research/trading-costs.ts'].map((p) => readFileSync(p)))),
  interpretation: 'Exploratory price-only daily-bar model; 2026 excluded and no broker order authorized.',
  coverage: source.coverage, comparisons };
writeFileSync('.trading/weekly-trend-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ ...report, comparisons: comparisons.map(({ trades, decisions, pending, ...rest }) => ({
  ...rest, trades: trades.length, decisions: decisions.length, pending: pending.length })) }, null, 2));
