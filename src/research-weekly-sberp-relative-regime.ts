import { readFileSync, writeFileSync } from 'node:fs';
import { digest } from './research/verified-candles.js';
import { simulateWeeklyMarketRegime } from './research/weekly-market-regime.js';
import { relativeStats } from './research/weekly-relative-strength.js';
import { auditWeeklyPortfolio } from './research/weekly-portfolio-risk.js';
import { simulateWeeklyTrend, type DailyBar } from './research/weekly-trend.js';

const protocolSha256 = digest(readFileSync('docs/WEEKLY_SBERP_RELATIVE_REGIME_V1.md'));
if (protocolSha256 !== '51d8e445c1031084b25f00c25eb51a7ed4a1ae7bb53e86cea7b6d824e65e9336') {
  throw new Error('Frozen SBERP relative-regime protocol changed');
}
function source(path: string, hash: string, count: number) {
  const value = JSON.parse(readFileSync(path, 'utf8')) as { rowsSha256: string; rows: DailyBar[] };
  if (value.rowsSha256 !== hash || value.rows.length !== count || digest(JSON.stringify(value.rows)) !== hash) {
    throw new Error(`Frozen source changed: ${path}`);
  }
  return value;
}
const sberp = source('.trading/sberp-daily-2015-2025.json',
  '099fbd5eae7e056a2aea986048792175a6bc5139264ffa65d037b908cd28631e', 2827);
const sber = source('.trading/sber-daily-2015-2025.json',
  '07fa1ee1facc96812b196a910525238e1257113906d7abc2187a16fc141093ab', 2827);
const imoex = source('.trading/imoex-daily-2015-2025.json',
  'ac3c41fdedaabdf78e64dd48f2d03b08c362bd88453b81a90eb73c483a2e4cc0', 2764);
const result = simulateWeeklyMarketRegime(sberp.rows, sber.rows, imoex.rows);
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
if (periods.some((period) => period.trades === 0 || period.winRate === null || period.winRate < 0.51 ||
  period.meanNetPct === null || period.meanNetPct <= 0)) reasons.push('failed-period-gate');
if (years.some((year) => year.trades === 0)) reasons.push('unobserved-year');
if (years.some((year) => year.trades > 0 && (year.meanNetPct === null || year.meanNetPct <= 0))) {
  reasons.push('failed-year-gate');
}
const control = simulateWeeklyTrend(sberp.rows, 'always-long');
const report = { experiment: 'weekly-sberp-relative-regime-v1', protocolSha256,
  sourceSha256: { sberp: sberp.rowsSha256, sber: sber.rowsSha256, imoex: imoex.rowsSha256 },
  codeSha256: digest(Buffer.concat(['src/research-weekly-sberp-relative-regime.ts',
    'src/research/weekly-market-regime.ts', 'src/research/trading-costs.ts',
    'src/research/weekly-portfolio-risk.ts'].map((path) => readFileSync(path)))),
  ...result, combined, periods, years, portfolio,
  status: reasons.length ? 'rejected-in-discovery' : 'requires-independent-test-not-tradeable', reasons,
  control: { completedTrades: control.trades.length, endingLiquidationValue: control.endingLiquidationValue } };
writeFileSync('.trading/weekly-sberp-relative-regime-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ experiment: report.experiment, protocolSha256, sourceSha256: report.sourceSha256,
  codeSha256: report.codeSha256, combined, periods, years, status: report.status, reasons,
  portfolio: { activeWeeks: portfolio.activeWeeks, positiveActiveWeeks: portfolio.positiveActiveWeeks,
    activeWeekWinRate: portfolio.activeWeekWinRate, maxDrawdownPct: portfolio.maxDrawdownPct,
    byYear: portfolio.byYear }, endingLiquidationValue: result.endingLiquidationValue,
  control: report.control }, null, 2));
