import { readFileSync, writeFileSync } from 'node:fs';
import { digest } from './research/verified-candles.js';
import { relativeStats } from './research/weekly-relative-strength.js';
import { auditWeeklyPortfolio } from './research/weekly-portfolio-risk.js';
import { simulateWeeklySberpTrendPullback } from './research/weekly-sberp-trend-pullback.js';
import type { DailyBar } from './research/weekly-trend.js';

const ruleSha256 = digest(readFileSync('docs/WEEKLY_SBERP_TREND_PULLBACK_V1.md'));
if (ruleSha256 !== 'ce420b9adbd61fdadadf74316d9c5d0d62808ad7273f6b5d275be8425583fe04') {
  throw new Error('Frozen rule changed');
}
const validationSha256 = digest(readFileSync('docs/WEEKLY_SBERP_TREND_PULLBACK_PRE2015_VALIDATION.md'));
if (validationSha256 !== '290952626ab9d7df17947d7c8b1cef730838b445cc93dab50da521132e1e649c') {
  throw new Error('Frozen validation plan changed');
}
const source = JSON.parse(readFileSync('.trading/sberp-daily-2007-2014.json', 'utf8')) as
  { rowsSha256: string; rows: DailyBar[]; coverage: { year: number; count: number }[] };
if (source.rowsSha256 !== 'd57ac049daa6b5c3e5219e7553fe2b1403762d1a9e4d00ebce5373f1f31e0eaf' ||
  source.rows.length !== 1862 || digest(JSON.stringify(source.rows)) !== source.rowsSha256 ||
  source.coverage.length !== 8 || source.coverage.some((year) =>
    year.count < (year.year === 2007 ? 100 : 150))) throw new Error('Frozen early source changed');
const result = simulateWeeklySberpTrendPullback(source.rows);
const portfolio = auditWeeklyPortfolio(source.rows, result.trades, result.pending, result.endingCash);
const combined = relativeStats(result.trades);
const years = Array.from({ length: 7 }, (_, index) => 2008 + index).map((year) => ({ year,
  ...relativeStats(result.trades.filter((trade) => trade.entryDay.startsWith(String(year)))) }));
const reasons: string[] = [];
if (combined.trades < 100 || combined.weeks < 50) reasons.push('insufficient-independent-sample');
if (combined.winRate === null || combined.winRate < 0.51 || combined.meanNetPct === null ||
  combined.meanNetPct <= 0 || combined.stressMeanPct === null || combined.stressMeanPct <= 0 ||
  combined.profitFactor === null || combined.profitFactor <= 1 ||
  combined.withoutBestFiveSumPct <= 0 || portfolio.activeWeekWinRate === null ||
  portfolio.activeWeekWinRate < 0.51) reasons.push('failed-independent-combined-gate');
if (years.some((year) => year.trades === 0)) reasons.push('unobserved-year');
if (years.some((year) => year.trades > 0 && (year.meanNetPct === null || year.meanNetPct <= 0))) {
  reasons.push('failed-independent-year-gate');
}
const report = { experiment: 'weekly-sberp-trend-pullback-pre2015-validation', ruleSha256,
  validationSha256, sourceSha256: source.rowsSha256,
  codeSha256: digest(Buffer.concat(['src/research-weekly-sberp-trend-pullback-pre2015.ts',
    'src/research/weekly-sberp-trend-pullback.ts', 'src/research/trading-costs.ts',
    'src/research/weekly-portfolio-risk.ts'].map((path) => readFileSync(path)))),
  coverage: source.coverage, ...result, combined, years, portfolio,
  status: reasons.length ? 'failed-independent-validation' : 'passed-independent-period-but-not-tradeable', reasons };
writeFileSync('.trading/weekly-sberp-trend-pullback-pre2015.json', JSON.stringify(report, null, 2),
  { mode: 0o600 });
console.log(JSON.stringify({ experiment: report.experiment, ruleSha256, validationSha256,
  sourceSha256: source.rowsSha256, codeSha256: report.codeSha256, combined, years,
  status: report.status, reasons, pendingCount: result.pending.length,
  portfolio: { activeWeeks: portfolio.activeWeeks, positiveActiveWeeks: portfolio.positiveActiveWeeks,
    activeWeekWinRate: portfolio.activeWeekWinRate, maxDrawdownPct: portfolio.maxDrawdownPct,
    endingCloseLiquidationValue: portfolio.endingCloseLiquidationValue,
    byYear: portfolio.byYear } }, null, 2));
