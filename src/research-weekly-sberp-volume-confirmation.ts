import { readFileSync, writeFileSync } from 'node:fs';
import { digest } from './research/verified-candles.js';
import { relativeStats } from './research/weekly-relative-strength.js';
import { auditWeeklyPortfolio } from './research/weekly-portfolio-risk.js';
import { simulateWeeklySberpVolumeConfirmation } from './research/weekly-sberp-volume-confirmation.js';
import type { DailyBar } from './research/weekly-trend.js';

const protocolSha256 = digest(readFileSync('docs/WEEKLY_SBERP_VOLUME_CONFIRMATION_V1.md'));
if (protocolSha256 !== 'cd1e576e278c7463b2371ee823f7f8dc62335ccfd3fd804ee0ad773b31d3fd71') {
  throw new Error('Frozen volume protocol changed');
}
const source = JSON.parse(readFileSync('.trading/sberp-daily-2007-2014.json', 'utf8')) as
  { rowsSha256: string; rows: DailyBar[] };
if (source.rowsSha256 !== 'd57ac049daa6b5c3e5219e7553fe2b1403762d1a9e4d00ebce5373f1f31e0eaf' ||
  source.rows.length !== 1862 || digest(JSON.stringify(source.rows)) !== source.rowsSha256) {
  throw new Error('Frozen early SBERP source changed');
}
const result = simulateWeeklySberpVolumeConfirmation(source.rows);
const portfolio = auditWeeklyPortfolio(source.rows, result.trades, result.pending, result.endingCash);
const combined = relativeStats(result.trades);
const years = Array.from({ length: 7 }, (_, index) => 2008 + index).map((year) => ({ year,
  ...relativeStats(result.trades.filter((trade) => trade.entryDay.startsWith(String(year)))) }));
const reasons: string[] = [];
if (combined.trades < 100 || combined.weeks < 50) reasons.push('insufficient-sample');
if (combined.winRate === null || combined.winRate < 0.51 || combined.meanNetPct === null ||
  combined.meanNetPct <= 0 || combined.stressMeanPct === null || combined.stressMeanPct <= 0 ||
  combined.profitFactor === null || combined.profitFactor <= 1 ||
  combined.withoutBestFiveSumPct <= 0 || portfolio.activeWeekWinRate === null ||
  portfolio.activeWeekWinRate < 0.51) reasons.push('failed-combined-gate');
if (years.some((year) => year.trades === 0)) reasons.push('unobserved-year');
if (years.some((year) => year.trades > 0 && (year.meanNetPct === null || year.meanNetPct <= 0))) {
  reasons.push('failed-year-gate');
}
const report = { experiment: 'weekly-sberp-volume-confirmation-v1-early', protocolSha256,
  sourceSha256: source.rowsSha256,
  codeSha256: digest(Buffer.concat(['src/research-weekly-sberp-volume-confirmation.ts',
    'src/research/weekly-sberp-volume-confirmation.ts', 'src/research/trading-costs.ts',
    'src/research/weekly-portfolio-risk.ts'].map((path) => readFileSync(path)))),
  ...result, combined, years, portfolio,
  status: reasons.length ? 'rejected-in-discovery' : 'requires-later-period-validation', reasons };
writeFileSync('.trading/weekly-sberp-volume-confirmation-v1-early.json', JSON.stringify(report, null, 2),
  { mode: 0o600 });
console.log(JSON.stringify({ experiment: report.experiment, protocolSha256,
  sourceSha256: source.rowsSha256, codeSha256: report.codeSha256, combined, years,
  status: report.status, reasons, pendingCount: result.pending.length,
  portfolio: { activeWeeks: portfolio.activeWeeks, positiveActiveWeeks: portfolio.positiveActiveWeeks,
    activeWeekWinRate: portfolio.activeWeekWinRate, maxDrawdownPct: portfolio.maxDrawdownPct,
    endingCloseLiquidationValue: portfolio.endingCloseLiquidationValue } }, null, 2));
