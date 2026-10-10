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

const protocolSha256 = digest(readFileSync('docs/SBGB_SBMM_RELATIVE_LAG_V1.md'));
if (protocolSha256 !== '6a3f4c5cc30fd43bfd43207006bf9a238f8af5fd717d4b7f9657bade5da8ee36') {
  throw new Error('Frozen SBGB/SBMM relative-lag protocol changed');
}
const sbgbSource = JSON.parse(readFileSync('.trading/sbgb-daily-2021-2025.json', 'utf8')) as {
  rowsSha256: string;
  rows: DailyBar[];
  coverage: { year: number; count: number }[];
};
const sbmmSource = JSON.parse(readFileSync('.trading/sbmm-daily-2021-2025.json', 'utf8')) as {
  rowsSha256: string;
  rows: DailyBar[];
  coverage: { year: number; count: number }[];
};
if (sbgbSource.rowsSha256 !== 'ea9f54cd20cbb14f65fc98656bb9cae23a1df23b35a4bb044304ffb53cc1a36a' ||
  digest(JSON.stringify(sbgbSource.rows)) !== sbgbSource.rowsSha256) {
  throw new Error('Frozen SBGB source changed');
}
if (digest(JSON.stringify(sbmmSource.rows)) !== sbmmSource.rowsSha256) throw new Error('SBMM rows hash mismatch');
if (sbmmSource.rowsSha256 !== '6a70207aa52c48b620597cacadaab117de9d858711a1fae5047f2f075b88eca3') {
  throw new Error('Frozen SBMM source changed');
}
if (sbgbSource.coverage.filter((year) => year.year >= 2023).some((year) => year.count < 150) ||
  sbmmSource.coverage.filter((year) => year.year >= 2023).some((year) => year.count < 150)) {
  throw new Error('Coverage below the frozen 2023-2025 floor');
}

function holdStats(rows: DailyBar[], from: string, thru: string) {
  const hold = buyAndHoldLqdt(rows, from, thru);
  const bars = rows.filter((bar) => bar.day <= thru);
  const portfolio = auditWeeklyPortfolio(
    bars,
    [
      {
        entryDay: hold.entryDay,
        exitDay: hold.finalDay,
        entry: hold.entry,
        principal: 1_000_000,
        proceeds: hold.endingLiquidationValue,
      },
    ],
    [],
    hold.endingLiquidationValue,
  );
  return { hold, portfolio };
}

function run(from: string, thru: string) {
  const aligned = alignWeekdayBars(
    sbgbSource.rows.filter((bar) => bar.day <= thru),
    sbmmSource.rows.filter((bar) => bar.day <= thru),
  );
  const result = simulateSbgbSbmmRelativeLag(sbgbSource.rows, sbmmSource.rows, from, thru, 'relative-lag');
  const control = simulateSbgbSbmmRelativeLag(sbgbSource.rows, sbmmSource.rows, from, thru, 'always-long-sbgb');
  const portfolio = auditWeeklyPortfolio(aligned.left, result.trades, result.pending, result.endingCash);
  const controlPortfolio = auditWeeklyPortfolio(aligned.left, control.trades, control.pending, control.endingCash);
  const sbgbHold = holdStats(aligned.left, from, thru);
  const sbmmHold = holdStats(aligned.right, from, thru);
  return {
    from,
    thru,
    alignedDays: aligned.left.length,
    result,
    stats: relativeStats(result.trades),
    stressWinners: result.trades.filter((trade) => trade.stressPct > 0).length,
    portfolio,
    control: { stats: relativeStats(control.trades), endingLiquidationValue: control.endingLiquidationValue, portfolio: controlPortfolio },
    sbgbBuyAndHold: sbgbHold.hold.endingLiquidationValue,
    sbmmBuyAndHold: sbmmHold.hold.endingLiquidationValue,
    sbgbHoldDrawdownPct: sbgbHold.portfolio.maxDrawdownPct,
    sbmmHoldDrawdownPct: sbmmHold.portfolio.maxDrawdownPct,
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
if (combined.result.endingLiquidationValue <= combined.sbgbBuyAndHold) reasons.push('inferior-to-sbgb-buy-and-hold');
if (combined.result.endingLiquidationValue <= combined.sbmmBuyAndHold) reasons.push('inferior-to-sbmm-cash-sleeve');
const report = {
  experiment: 'sbgb-sbmm-relative-lag-v1',
  protocolSha256,
  sbgbSourceSha256: sbgbSource.rowsSha256,
  sbmmSourceSha256: sbmmSource.rowsSha256,
  breakevenRatio: sbgbSbmmBreakevenRatio,
  discovery,
  validation,
  combined,
  years,
  status: reasons.length ? 'not-admitted' : 'requires-execution-and-rights-audit-not-tradeable',
  reasons,
};
writeFileSync('.trading/sbgb-sbmm-relative-lag-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
const summary = (period: typeof discovery) => ({
  from: period.from,
  thru: period.thru,
  alignedDays: period.alignedDays,
  stats: period.stats,
  stressWinners: period.stressWinners,
  pending: period.result.pending.length,
  endingLiquidationValue: period.result.endingLiquidationValue,
  activeWeekWinRate: period.portfolio.activeWeekWinRate,
  maxDrawdownPct: period.portfolio.maxDrawdownPct,
  controlEnding: period.control.endingLiquidationValue,
  sbgbBuyAndHold: period.sbgbBuyAndHold,
  sbmmBuyAndHold: period.sbmmBuyAndHold,
});
console.log(JSON.stringify({
  experiment: report.experiment,
  protocolSha256,
  sbgbSourceSha256: sbgbSource.rowsSha256,
  sbmmSourceSha256: sbmmSource.rowsSha256,
  discovery: summary(discovery),
  validation: summary(validation),
  combined: summary(combined),
  years,
  status: report.status,
  reasons,
}, null, 2));
