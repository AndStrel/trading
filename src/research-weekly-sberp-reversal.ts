import { readFileSync, writeFileSync } from 'node:fs';
import { digest } from './research/verified-candles.js';
import { relativeStats } from './research/weekly-relative-strength.js';
import { auditWeeklyPortfolio } from './research/weekly-portfolio-risk.js';
import { simulateWeeklySberpReversal } from './research/weekly-sberp-reversal.js';
import type { DailyBar } from './research/weekly-trend.js';

const protocolSha256 = digest(readFileSync('docs/WEEKLY_SBERP_REVERSAL_V1.md'));
if (protocolSha256 !== 'f19fb2607dec3e418cef07314660ef5b75c2c024b896e2b7ac8416d27a231444') {
  throw new Error('Frozen SBERP reversal protocol changed');
}
const amendmentSha256 = digest(readFileSync('docs/WEEKLY_SBERP_REVERSAL_V1_AMENDMENT.md'));
if (amendmentSha256 !== '9719a56e8fe76d7b7ad2abaf4248b47c762a710b5f6f2b9996f2bfd3479693c9') {
  throw new Error('Temporal-integrity amendment changed');
}
const data = JSON.parse(readFileSync('.trading/sberp-daily-2015-2025.json', 'utf8')) as
  { rowsSha256: string; rows: DailyBar[] };
if (data.rowsSha256 !== '099fbd5eae7e056a2aea986048792175a6bc5139264ffa65d037b908cd28631e' ||
  data.rows.length !== 2827 || digest(JSON.stringify(data.rows)) !== data.rowsSha256) {
  throw new Error('Frozen SBERP daily source changed');
}
const result = simulateWeeklySberpReversal(data.rows, 'reversal');
const portfolio = auditWeeklyPortfolio(data.rows, result.trades, result.pending, result.endingCash);
const combined = relativeStats(result.trades);
const groups = [
  { name: '2016-2019', from: 2016, to: 2019 },
  { name: '2020-2022', from: 2020, to: 2022 },
  { name: '2023-2025', from: 2023, to: 2025 },
];
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
  combined.withoutBestFiveSumPct <= 0 || portfolio.activeWeekWinRate === null ||
  portfolio.activeWeekWinRate < 0.51) reasons.push('failed-combined-gate');
if (periods.some((period) => period.trades === 0 || period.meanNetPct === null || period.meanNetPct <= 0)) {
  reasons.push('failed-period-gate');
}
if (years.some((year) => year.trades === 0)) reasons.push('unobserved-year');
if (years.some((year) => year.trades > 0 && (year.meanNetPct === null || year.meanNetPct <= 0))) {
  reasons.push('failed-year-gate');
}
const control = simulateWeeklySberpReversal(data.rows, 'always-long');
const controlPortfolio = auditWeeklyPortfolio(data.rows, control.trades, control.pending, control.endingCash);
const report = { experiment: 'weekly-sberp-reversal-v1-amended', protocolSha256, amendmentSha256,
  sourceSha256: data.rowsSha256,
  codeSha256: digest(Buffer.concat(['src/research-weekly-sberp-reversal.ts',
    'src/research/weekly-sberp-reversal.ts', 'src/research/trading-costs.ts',
    'src/research/weekly-portfolio-risk.ts'].map((path) => readFileSync(path)))),
  ...result, combined, periods, years, portfolio,
  status: reasons.length ? 'rejected-in-discovery' : 'requires-independent-test-not-tradeable', reasons,
  control: { combined: relativeStats(control.trades), portfolio: controlPortfolio,
    endingLiquidationValue: control.endingLiquidationValue } };
writeFileSync('.trading/weekly-sberp-reversal-v1-amended.json', JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ experiment: report.experiment, protocolSha256, amendmentSha256,
  sourceSha256: data.rowsSha256,
  codeSha256: report.codeSha256, combined, periods, years, status: report.status, reasons,
  portfolio: { activeWeeks: portfolio.activeWeeks, positiveActiveWeeks: portfolio.positiveActiveWeeks,
    activeWeekWinRate: portfolio.activeWeekWinRate, maxDrawdownPct: portfolio.maxDrawdownPct,
    endingCloseLiquidationValue: portfolio.endingCloseLiquidationValue },
  longestHoldDays: Math.max(...result.trades.map((trade) =>
    (Date.parse(trade.exitDay) - Date.parse(trade.entryDay)) / 86_400_000)),
  control: { combined: report.control.combined, activeWeekWinRate: controlPortfolio.activeWeekWinRate,
    maxDrawdownPct: controlPortfolio.maxDrawdownPct,
    endingLiquidationValue: control.endingLiquidationValue } }, null, 2));
