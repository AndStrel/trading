import { readFileSync, writeFileSync } from 'node:fs';
import { auditWeeklyPortfolio } from './research/weekly-portfolio-risk.js';
import { relativeStats } from './research/weekly-relative-strength.js';
import { simulateWeeklySberpDiscount } from './research/weekly-sberp-discount.js';
import { digest } from './research/verified-candles.js';
import { simulateWeeklyTrend, weeklyTrendStats, type DailyBar } from './research/weekly-trend.js';

const protocolSha256 = digest(readFileSync('docs/WEEKLY_SBERP_DISCOUNT_V1.md'));
if (protocolSha256 !== '6eaf7f8c5d8412564a5f305b2304d066218bb78d2e2ca37aad9572905baf2c0e') {
  throw new Error('Frozen SBERP protocol changed');
}
function source(path: string, expected: string) {
  const value = JSON.parse(readFileSync(path, 'utf8')) as { rowsSha256: string; rows: DailyBar[] };
  if (value.rowsSha256 !== expected || value.rows.length !== 2827 ||
    digest(JSON.stringify(value.rows)) !== expected) throw new Error(`Frozen source changed: ${path}`);
  return value;
}
const sber = source('.trading/sber-daily-2015-2025.json',
  '07fa1ee1facc96812b196a910525238e1257113906d7abc2187a16fc141093ab');
const sberp = source('.trading/sberp-daily-2015-2025.json',
  '099fbd5eae7e056a2aea986048792175a6bc5139264ffa65d037b908cd28631e');
const result = simulateWeeklySberpDiscount(sber.rows, sberp.rows);
const portfolio = auditWeeklyPortfolio(sberp.rows, result.trades, result.pending, result.endingCash);
const groups = [
  { name: '2016-2019', from: 2016, to: 2019 },
  { name: '2020-2022', from: 2020, to: 2022 },
  { name: '2023-2025', from: 2023, to: 2025 },
];
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
  combined.withoutBestFiveSumPct <= 0 || portfolio.activeWeekWinRate === null ||
  portfolio.activeWeekWinRate < 0.51) reasons.push('failed-combined-gate');
if (periods.some((period) => period.trades > 0 && (period.winRate === null || period.winRate < 0.51 ||
  period.meanNetPct === null || period.meanNetPct <= 0))) reasons.push('failed-period-gate');
if (years.some((year) => year.trades > 0 && (year.meanNetPct === null || year.meanNetPct <= 0))) {
  reasons.push('failed-year-gate');
}
if (years.some((year) => year.trades === 0)) reasons.push('unobserved-year');
const control = simulateWeeklyTrend(sberp.rows, 'always-long');
const controlPortfolio = auditWeeklyPortfolio(sberp.rows, control.trades, control.pending, control.endingCash);
const controlYears = years.map(({ year }) => ({ year,
  ...weeklyTrendStats(control.trades.filter((trade) => trade.entryDay.startsWith(String(year)))) }));
const report = { experiment: 'weekly-sberp-discount-v1', protocolSha256,
  sourceSha256: { sber: sber.rowsSha256, sberp: sberp.rowsSha256 },
  codeSha256: digest(Buffer.concat(['src/research-weekly-sberp-discount.ts',
    'src/research/weekly-sberp-discount.ts', 'src/research/trading-costs.ts',
    'src/research/weekly-portfolio-risk.ts'].map((path) => readFileSync(path)))),
  ...result, combined, periods, years, portfolio,
  status: reasons.length ? 'rejected-in-discovery' : 'requires-independent-test-not-tradeable', reasons,
  control: { combined: weeklyTrendStats(control.trades), years: controlYears,
    portfolio: controlPortfolio, endingLiquidationValue: control.endingLiquidationValue } };
writeFileSync('.trading/weekly-sberp-discount-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
const { trades: unusedTrades, decisions: unusedDecisions, pending, portfolio: detailedPortfolio, ...summary } = report;
const { portfolio: controlPortfolioDetail, ...controlSummary } = summary.control;
console.log(JSON.stringify({ ...summary, tradeCount: report.trades.length,
  control: { ...controlSummary, portfolio: { activeWeeks: controlPortfolioDetail.activeWeeks,
    positiveActiveWeeks: controlPortfolioDetail.positiveActiveWeeks,
    activeWeekWinRate: controlPortfolioDetail.activeWeekWinRate,
    maxDrawdownPct: controlPortfolioDetail.maxDrawdownPct,
    endingCloseLiquidationValue: controlPortfolioDetail.endingCloseLiquidationValue } },
  decisionCount: report.decisions.length, pendingCount: pending.length,
  portfolio: { activeWeeks: detailedPortfolio.activeWeeks,
    positiveActiveWeeks: detailedPortfolio.positiveActiveWeeks,
    activeWeekWinRate: detailedPortfolio.activeWeekWinRate,
    maxDrawdownPct: detailedPortfolio.maxDrawdownPct,
    endingCloseLiquidationValue: detailedPortfolio.endingCloseLiquidationValue } }, null, 2));
