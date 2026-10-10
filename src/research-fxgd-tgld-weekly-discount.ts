import { readFileSync, writeFileSync } from 'node:fs';
import { auditWeeklyPortfolio } from './research/weekly-portfolio-risk.js';
import { relativeStats } from './research/weekly-relative-strength.js';
import { simulateWeeklySberpDiscount } from './research/weekly-sberp-discount.js';
import { digest } from './research/verified-candles.js';
import { simulateWeeklyTrend, type DailyBar } from './research/weekly-trend.js';
import { buyAndHoldLqdt } from './research/weekly-lqdt-carry.js';
import { alignWeekdayBars } from './research/sbgb-sbmm-relative-lag.js';

const protocolSha256 = digest(readFileSync('docs/FXGD_TGLD_WEEKLY_DISCOUNT_V1.md'));
if (protocolSha256 !== '7acd7501408f426d2f771ac5aae22adc1be8a8e45c9f3709d67af8fc7bdfa766') {
  throw new Error('Frozen FXGD/TGLD weekly-discount protocol changed');
}

const fxgdSource = JSON.parse(readFileSync('.trading/fxgd-daily-2022-2025.json', 'utf8')) as {
  rowsSha256: string;
  rows: DailyBar[];
  coverage: { year: number; count: number }[];
};
const tgldSource = JSON.parse(readFileSync('.trading/tgld-daily-2022-2025.json', 'utf8')) as {
  rowsSha256: string;
  rows: DailyBar[];
};
const sbmmSource = JSON.parse(readFileSync('.trading/sbmm-daily-2021-2025.json', 'utf8')) as {
  rowsSha256: string;
  rows: DailyBar[];
};
if (digest(JSON.stringify(fxgdSource.rows)) !== fxgdSource.rowsSha256) throw new Error('FXGD rows hash mismatch');
if (fxgdSource.rowsSha256 !== 'PIN_FXGD') throw new Error('Frozen FXGD source changed');
if (tgldSource.rowsSha256 !== '347575ab305338bcc9408be815366a5c12f37b164c10a5e08bf024a5e653ca2f') {
  throw new Error('Frozen TGLD source changed');
}
if (sbmmSource.rowsSha256 !== '6a70207aa52c48b620597cacadaab117de9d858711a1fae5047f2f075b88eca3') {
  throw new Error('Frozen SBMM source changed');
}
if (fxgdSource.coverage.filter((year) => year.year >= 2023).some((year) => year.count < 150 || year.count > 400)) {
  throw new Error('FXGD 2023-2025 coverage outside 150-400');
}

const aligned = alignWeekdayBars(tgldSource.rows, fxgdSource.rows);
if (aligned.left.length !== aligned.right.length) throw new Error('Aligned gold calendars drifted');
const tgld = aligned.left;
const fxgd = aligned.right;

function run(from: string, thru: string) {
  const result = simulateWeeklySberpDiscount(tgld, fxgd, from, thru);
  const portfolio = auditWeeklyPortfolio(fxgd, result.trades, result.pending, result.endingCash);
  return { from, thru, result, stats: relativeStats(result.trades), portfolio };
}

const discovery = run('2023-01-01', '2024-12-31');
const validation = run('2025-01-01', '2025-12-31');
const combined = run('2023-01-01', '2025-12-31');
const years = [2023, 2024, 2025].map((year) => ({
  year,
  ...relativeStats(combined.result.trades.filter((trade) => trade.entryDay.startsWith(String(year)))),
}));
const profitFactorPasses = (stats: ReturnType<typeof relativeStats>) =>
  (stats.profitFactor !== null && stats.profitFactor > 1) ||
  (stats.profitFactor === null && stats.trades > 0 && stats.winners === stats.trades);
const reasons: string[] = [];
if (combined.stats.trades < 50 || combined.stats.weeks < 30) reasons.push('insufficient-sample');
for (const period of [discovery, validation, combined]) {
  const { stats, portfolio, result } = period;
  if (
    stats.winRate === null ||
    stats.winRate < 0.51 ||
    stats.meanNetPct === null ||
    stats.meanNetPct <= 0 ||
    stats.stressMeanPct === null ||
    stats.stressMeanPct <= 0 ||
    !profitFactorPasses(stats) ||
    stats.withoutBestFiveSumPct <= 0 ||
    portfolio.activeWeekWinRate === null ||
    portfolio.activeWeekWinRate < 0.51 ||
    result.endingLiquidationValue <= 1_000_000
  ) {
    reasons.push(`failed-${period.from}-${period.thru}-gate`);
  }
}
if (years.some((year) => year.trades === 0 || year.meanNetPct === null || year.meanNetPct <= 0)) {
  reasons.push('failed-year-gate');
}
const control = simulateWeeklyTrend(fxgd.filter((bar) => bar.day >= '2023-01-01'), 'always-long');
const fxgdHold = buyAndHoldLqdt(fxgd, '2023-01-01', '2025-12-31');
const tgldHold = buyAndHoldLqdt(tgld, '2023-01-01', '2025-12-31');
const sbmmHold = buyAndHoldLqdt(sbmmSource.rows, '2023-01-01', '2025-12-31');
if (combined.result.endingLiquidationValue <= fxgdHold.endingLiquidationValue) {
  reasons.push('inferior-to-fxgd-buy-and-hold');
}
if (combined.result.endingLiquidationValue <= tgldHold.endingLiquidationValue) {
  reasons.push('inferior-to-tgld-buy-and-hold');
}
if (combined.result.endingLiquidationValue <= sbmmHold.endingLiquidationValue) {
  reasons.push('inferior-to-sbmm-cash-sleeve');
}
const report = {
  experiment: 'fxgd-tgld-weekly-discount-v1',
  protocolSha256,
  fxgdSourceSha256: fxgdSource.rowsSha256,
  tgldSourceSha256: tgldSource.rowsSha256,
  alignedDays: aligned.left.length,
  discovery: { ...discovery, resultEnding: discovery.result.endingLiquidationValue },
  validation: { ...validation, resultEnding: validation.result.endingLiquidationValue },
  combined: { ...combined, resultEnding: combined.result.endingLiquidationValue },
  years,
  controlEnding: control.endingLiquidationValue,
  fxgdBuyAndHold: fxgdHold.endingLiquidationValue,
  tgldBuyAndHold: tgldHold.endingLiquidationValue,
  sbmmBuyAndHold: sbmmHold.endingLiquidationValue,
  status: reasons.length ? 'not-admitted' : 'requires-execution-and-rights-audit-not-tradeable',
  reasons,
};
writeFileSync('.trading/fxgd-tgld-weekly-discount-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
const summary = (period: typeof discovery) => ({
  from: period.from,
  thru: period.thru,
  stats: period.stats,
  ending: period.result.endingLiquidationValue,
  activeWeekWinRate: period.portfolio.activeWeekWinRate,
  maxDrawdownPct: period.portfolio.maxDrawdownPct,
});
console.log(JSON.stringify({
  experiment: report.experiment,
  protocolSha256,
  fxgdSourceSha256: fxgdSource.rowsSha256,
  alignedDays: report.alignedDays,
  discovery: summary(discovery),
  validation: summary(validation),
  combined: summary(combined),
  years,
  fxgdBuyAndHold: report.fxgdBuyAndHold,
  tgldBuyAndHold: report.tgldBuyAndHold,
  sbmmBuyAndHold: report.sbmmBuyAndHold,
  status: report.status,
  reasons,
}, null, 2));
