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
const source = JSON.parse(readFileSync('.trading/sberp-daily-2015-2025.json', 'utf8')) as
  { rowsSha256: string; rows: DailyBar[] };
if (source.rowsSha256 !== '099fbd5eae7e056a2aea986048792175a6bc5139264ffa65d037b908cd28631e' ||
  source.rows.length !== 2827 || digest(JSON.stringify(source.rows)) !== source.rowsSha256) {
  throw new Error('Frozen later SBERP source changed');
}
const result = simulateWeeklySberpVolumeConfirmation(source.rows);
const portfolio = auditWeeklyPortfolio(source.rows, result.trades, result.pending, result.endingCash);
const combined = relativeStats(result.trades);
const years = Array.from({ length: 11 }, (_, index) => 2015 + index).map((year) => ({ year,
  ...relativeStats(result.trades.filter((trade) => trade.entryDay.startsWith(String(year)))) }));
const groups = [
  { name: '2015-2019', from: 2015, to: 2019 },
  { name: '2020-2022', from: 2020, to: 2022 },
  { name: '2023-2025', from: 2023, to: 2025 },
];
const periods = groups.map((group) => ({ group: group.name,
  ...relativeStats(result.trades.filter((trade) => {
    const year = Number(trade.entryDay.slice(0, 4));
    return year >= group.from && year <= group.to;
  })) }));
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
if (periods.some((period) => period.trades === 0 || period.meanNetPct === null ||
  period.meanNetPct <= 0)) reasons.push('failed-period-gate');
const report = { experiment: 'weekly-sberp-volume-confirmation-v1-later-diagnostic', protocolSha256,
  sourceSha256: source.rowsSha256,
  codeSha256: digest(Buffer.concat(['src/research-weekly-sberp-volume-confirmation-later.ts',
    'src/research/weekly-sberp-volume-confirmation.ts', 'src/research/trading-costs.ts',
    'src/research/weekly-portfolio-risk.ts'].map((path) => readFileSync(path)))),
  ...result, combined, years, periods, portfolio,
  status: reasons.length ? 'failed-later-diagnostic' : 'later-period-passed-but-early-period-failed', reasons };
writeFileSync('.trading/weekly-sberp-volume-confirmation-v1-later.json', JSON.stringify(report, null, 2),
  { mode: 0o600 });
console.log(JSON.stringify({ experiment: report.experiment, protocolSha256,
  sourceSha256: source.rowsSha256, codeSha256: report.codeSha256, combined, years, periods,
  status: report.status, reasons, pendingCount: result.pending.length,
  portfolio: { activeWeeks: portfolio.activeWeeks, positiveActiveWeeks: portfolio.positiveActiveWeeks,
    activeWeekWinRate: portfolio.activeWeekWinRate, maxDrawdownPct: portfolio.maxDrawdownPct,
    endingCloseLiquidationValue: portfolio.endingCloseLiquidationValue } }, null, 2));
