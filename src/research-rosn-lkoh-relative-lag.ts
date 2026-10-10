import { readFileSync, writeFileSync } from 'node:fs';
import { digest } from './research/verified-candles.js';
import { relativeStats } from './research/weekly-relative-strength.js';
import { auditWeeklyPortfolio } from './research/weekly-portfolio-risk.js';
import { buyAndHoldLqdt } from './research/weekly-lqdt-carry.js';
import {
  alignWeekdayBars,
  sbgbSbmmBreakevenRatio,
  simulateSbgbSbmmRelativeLag,
} from './research/sbgb-sbmm-relative-lag.js';
import type { DailyBar } from './research/weekly-trend.js';

const protocolSha256 = digest(readFileSync('docs/ROSN_LKOH_RELATIVE_LAG_V1.md'));
if (protocolSha256 !== 'f2a7e263b20b97682c0e0c741373077cd2cd08c82166f00eeb2bcbed99f53964') {
  throw new Error('Frozen ROSN/LKOH relative-lag protocol changed');
}
const rosnSource = JSON.parse(readFileSync('.trading/rosn-daily-2021-2025.json', 'utf8')) as {
  rowsSha256: string;
  rows: DailyBar[];
  coverage: { year: number; count: number }[];
};
const lkohSource = JSON.parse(readFileSync('.trading/lkoh-daily-2021-2025.json', 'utf8')) as {
  rowsSha256: string;
  rows: DailyBar[];
  coverage: { year: number; count: number }[];
};
const sbmmSource = JSON.parse(readFileSync('.trading/sbmm-daily-2021-2025.json', 'utf8')) as {
  rowsSha256: string;
  rows: DailyBar[];
};
if (digest(JSON.stringify(rosnSource.rows)) !== rosnSource.rowsSha256) throw new Error('ROSN rows hash mismatch');
if (digest(JSON.stringify(lkohSource.rows)) !== lkohSource.rowsSha256) throw new Error('LKOH rows hash mismatch');
if (rosnSource.rowsSha256 !== '68f0731e9cf77b4add121411753e2d6805f081a8dec6b8d157cb865e1d274d06') {
  throw new Error('Frozen ROSN source changed');
}
if (lkohSource.rowsSha256 !== 'c6ac11b117d326a4272da5349d0f6778146af80840d63686e18889d4f96f512a') {
  throw new Error('Frozen LKOH source changed');
}
if (sbmmSource.rowsSha256 !== '6a70207aa52c48b620597cacadaab117de9d858711a1fae5047f2f075b88eca3') {
  throw new Error('Frozen SBMM source changed');
}
if (rosnSource.coverage.filter((year) => year.year >= 2023).some((year) => year.count < 150 || year.count > 400) ||
  lkohSource.coverage.filter((year) => year.year >= 2023).some((year) => year.count < 150 || year.count > 400)) {
  throw new Error('2023-2025 coverage outside 150-400');
}

function holdStats(rows: DailyBar[], from: string, thru: string) {
  const hold = buyAndHoldLqdt(rows, from, thru);
  return hold;
}

function run(from: string, thru: string) {
  const pair = alignWeekdayBars(
    rosnSource.rows.filter((bar) => bar.day <= thru),
    lkohSource.rows.filter((bar) => bar.day <= thru),
  );
  const withCash = alignWeekdayBars(pair.left, sbmmSource.rows.filter((bar) => bar.day <= thru));
  const result = simulateSbgbSbmmRelativeLag(rosnSource.rows, lkohSource.rows, from, thru, 'relative-lag');
  const control = simulateSbgbSbmmRelativeLag(rosnSource.rows, lkohSource.rows, from, thru, 'always-long-sbgb');
  const portfolio = auditWeeklyPortfolio(pair.left, result.trades, result.pending, result.endingCash);
  return {
    from,
    thru,
    alignedDays: pair.left.length,
    result,
    stats: relativeStats(result.trades),
    stressWinners: result.trades.filter((trade) => trade.stressPct > 0).length,
    portfolio,
    controlEnding: control.endingLiquidationValue,
    rosnBuyAndHold: holdStats(pair.left, from, thru).endingLiquidationValue,
    lkohBuyAndHold: holdStats(pair.right, from, thru).endingLiquidationValue,
    sbmmBuyAndHold: holdStats(withCash.right, from, thru).endingLiquidationValue,
    maxDrawdownPct: portfolio.maxDrawdownPct,
    activeWeekWinRate: portfolio.activeWeekWinRate,
  };
}

const discovery = run('2023-01-01', '2024-12-31');
const validation = run('2025-01-01', '2025-12-31');
const combined = run('2023-01-01', '2025-12-31');
const years = [2023, 2024, 2025].map((year) => ({
  year,
  ...relativeStats(combined.result.trades.filter((trade) => trade.entryDay.startsWith(String(year)))),
}));
const reasons: string[] = [];
const profitFactorPasses = (stats: ReturnType<typeof relativeStats>) =>
  (stats.profitFactor !== null && stats.profitFactor > 1) ||
  (stats.profitFactor === null && stats.trades > 0 && stats.winners === stats.trades);
if (combined.stats.trades < 100 || combined.stats.weeks < 50) reasons.push('insufficient-combined-sample');
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
if (combined.result.endingLiquidationValue <= combined.rosnBuyAndHold) reasons.push('inferior-to-rosn-buy-and-hold');
if (combined.result.endingLiquidationValue <= combined.lkohBuyAndHold) reasons.push('inferior-to-lkoh-buy-and-hold');
if (combined.result.endingLiquidationValue <= combined.sbmmBuyAndHold) reasons.push('inferior-to-sbmm-cash-sleeve');
const report = {
  experiment: 'rosn-lkoh-relative-lag-v1',
  protocolSha256,
  rosnSourceSha256: rosnSource.rowsSha256,
  lkohSourceSha256: lkohSource.rowsSha256,
  sbmmSourceSha256: sbmmSource.rowsSha256,
  breakevenRatio: sbgbSbmmBreakevenRatio,
  discovery,
  validation,
  combined,
  years,
  status: reasons.length ? 'not-admitted' : 'requires-execution-and-rights-audit-not-tradeable',
  reasons,
};
writeFileSync('.trading/rosn-lkoh-relative-lag-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
const summary = (period: typeof discovery) => ({
  from: period.from,
  thru: period.thru,
  alignedDays: period.alignedDays,
  stats: period.stats,
  stressWinners: period.stressWinners,
  pending: period.result.pending.length,
  endingLiquidationValue: period.result.endingLiquidationValue,
  activeWeekWinRate: period.activeWeekWinRate,
  maxDrawdownPct: period.maxDrawdownPct,
  controlEnding: period.controlEnding,
  rosnBuyAndHold: period.rosnBuyAndHold,
  lkohBuyAndHold: period.lkohBuyAndHold,
  sbmmBuyAndHold: period.sbmmBuyAndHold,
});
console.log(JSON.stringify({
  experiment: report.experiment,
  protocolSha256,
  rosnSourceSha256: rosnSource.rowsSha256,
  lkohSourceSha256: lkohSource.rowsSha256,
  discovery: summary(discovery),
  validation: summary(validation),
  combined: summary(combined),
  years,
  status: report.status,
  reasons,
}, null, 2));
