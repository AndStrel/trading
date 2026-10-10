import { readFileSync, writeFileSync } from 'node:fs';
import { digest } from './research/verified-candles.js';
import { simulateWeeklyRelativeStrength, relativeStats } from './research/weekly-relative-strength.js';
import { simulateWeeklyTrend, weeklyTrendStats, type DailyBar } from './research/weekly-trend.js';

const protocolSha256 = digest(readFileSync('docs/WEEKLY_RELATIVE_STRENGTH_V1.md'));
if (protocolSha256 !== 'debc48cead91b3dd44524f7e8cb3b07bfb454ccdb9303577eb8d3af3c39ff282') {
  throw new Error('Frozen relative-strength protocol changed');
}
function source(path: string, expectedHash: string) {
  const value = JSON.parse(readFileSync(path, 'utf8')) as { rowsSha256: string; rows: DailyBar[] };
  if (value.rowsSha256 !== expectedHash || value.rows.length !== 2827 ||
    digest(JSON.stringify(value.rows)) !== expectedHash) throw new Error(`Frozen source changed: ${path}`);
  return value;
}
const sber = source('.trading/sber-daily-2015-2025.json',
  '07fa1ee1facc96812b196a910525238e1257113906d7abc2187a16fc141093ab');
const gazp = source('.trading/gazp-daily-2015-2025.json',
  'd0705203ae7629cc0b919f5b2a6da8b5be333972d8c81aba8bc6d1b13923c261');
const groups = [
  { name: '2016-2019', from: 2016, to: 2019 },
  { name: '2020-2022', from: 2020, to: 2022 },
  { name: '2023-2025', from: 2023, to: 2025 },
];
const result = simulateWeeklyRelativeStrength(sber.rows, gazp.rows);
const combined = relativeStats(result.trades);
const periods = groups.map((group) => ({ group: group.name,
  ...relativeStats(result.trades.filter((trade) => {
    const year = Number(trade.entryDay.slice(0, 4));
    return year >= group.from && year <= group.to;
  })) }));
const years = Array.from({ length: 10 }, (_, index) => 2016 + index).map((year) => ({ year,
  ...relativeStats(result.trades.filter((trade) => trade.entryDay.startsWith(String(year)))) }));
const reasons: string[] = [];
if (combined.trades < 100 || combined.weeks < 50) reasons.push('insufficient-sample');
if (combined.winRate === null || combined.winRate < 0.51 || combined.meanNetPct === null ||
  combined.meanNetPct <= 0 || combined.profitFactor === null || combined.profitFactor <= 1 ||
  combined.withoutBestFiveSumPct <= 0) reasons.push('failed-combined-gate');
if (periods.some((period) => period.winRate === null || period.winRate < 0.51 ||
  period.meanNetPct === null || period.meanNetPct <= 0)) reasons.push('failed-period-gate');
if (years.some((year) => year.trades > 0 && (year.meanNetPct === null || year.meanNetPct <= 0))) {
  reasons.push('failed-year-gate');
}
const control = simulateWeeklyTrend(sber.rows, 'trend');
const report = { experiment: 'weekly-relative-strength-v1', protocolSha256,
  sourceSha256: { sber: sber.rowsSha256, gazp: gazp.rowsSha256 },
  codeSha256: digest(Buffer.concat(['src/research-weekly-relative-strength.ts',
    'src/research/weekly-relative-strength.ts', 'src/research/trading-costs.ts'].map((path) => readFileSync(path)))),
  ...result, combined, periods, years,
  status: reasons.length ? 'rejected-in-discovery' : 'requires-independent-test-not-tradeable', reasons,
  control: { combined: weeklyTrendStats(control.trades), endingLiquidationValue: control.endingLiquidationValue } };
writeFileSync('.trading/weekly-relative-strength-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
const { trades: unusedTrades, decisions: unusedDecisions, pending, ...summary } = report;
console.log(JSON.stringify({ ...summary, tradeCount: report.trades.length,
  decisionCount: report.decisions.length, pendingCount: pending.length }, null, 2));
