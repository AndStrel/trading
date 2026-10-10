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

const protocolSha256 = digest(readFileSync('docs/LKOH_SBMX_RELATIVE_LAG_V1.md'));
if (protocolSha256 !== '8cad9348122fc43d0080f8902ff4da5f409c522e6ed54d1ab06d936fa4b31c93') {
  throw new Error('Frozen LKOH/SBMX relative-lag protocol changed');
}
const lkohSource = JSON.parse(readFileSync('.trading/lkoh-daily-2021-2025.json', 'utf8')) as {
  rowsSha256: string;
  rows: DailyBar[];
  coverage: { year: number; count: number }[];
};
const sbmxSource = JSON.parse(readFileSync('.trading/sbmx-daily-2021-2025.json', 'utf8')) as {
  rowsSha256: string;
  rows: DailyBar[];
};
const sbmmSource = JSON.parse(readFileSync('.trading/sbmm-daily-2021-2025.json', 'utf8')) as {
  rowsSha256: string;
  rows: DailyBar[];
};
if (digest(JSON.stringify(lkohSource.rows)) !== lkohSource.rowsSha256) throw new Error('LKOH rows hash mismatch');
if (lkohSource.rowsSha256 !== 'c6ac11b117d326a4272da5349d0f6778146af80840d63686e18889d4f96f512a') {
  throw new Error('Frozen LKOH source changed');
}
if (sbmxSource.rowsSha256 !== '5f1f0e533a4bfc05d88014b3052245ffb55b430faebb9a23289521672effe64b') {
  throw new Error('Frozen SBMX source changed');
}
if (sbmmSource.rowsSha256 !== '6a70207aa52c48b620597cacadaab117de9d858711a1fae5047f2f075b88eca3') {
  throw new Error('Frozen SBMM source changed');
}
if (lkohSource.coverage.filter((year) => year.year >= 2023).some((year) => year.count < 150)) {
  throw new Error('LKOH 2023-2025 coverage below floor');
}

function holdStats(rows: DailyBar[], from: string, thru: string) {
  const hold = buyAndHoldLqdt(rows, from, thru);
  const bars = rows.filter((bar) => bar.day >= from && bar.day <= thru);
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
  const pair = alignWeekdayBars(
    lkohSource.rows.filter((bar) => bar.day <= thru),
    sbmxSource.rows.filter((bar) => bar.day <= thru),
  );
  const withCash = alignWeekdayBars(pair.left, sbmmSource.rows.filter((bar) => bar.day <= thru));
  const result = simulateSbgbSbmmRelativeLag(lkohSource.rows, sbmxSource.rows, from, thru, 'relative-lag');
  const control = simulateSbgbSbmmRelativeLag(lkohSource.rows, sbmxSource.rows, from, thru, 'always-long-sbgb');
  const portfolio = auditWeeklyPortfolio(pair.left, result.trades, result.pending, result.endingCash);
  const lkohHold = holdStats(pair.left, from, thru);
  const sbmxHold = holdStats(pair.right, from, thru);
  const sbmmHold = holdStats(withCash.right, from, thru);
  return {
    from,
    thru,
    alignedDays: pair.left.length,
    result,
    stats: relativeStats(result.trades),
    stressWinners: result.trades.filter((trade) => trade.stressPct > 0).length,
    portfolio,
    controlEnding: control.endingLiquidationValue,
    lkohBuyAndHold: lkohHold.hold.endingLiquidationValue,
    sbmxBuyAndHold: sbmxHold.hold.endingLiquidationValue,
    sbmmBuyAndHold: sbmmHold.hold.endingLiquidationValue,
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
if (combined.result.endingLiquidationValue <= combined.lkohBuyAndHold) reasons.push('inferior-to-lkoh-buy-and-hold');
if (combined.result.endingLiquidationValue <= combined.sbmxBuyAndHold) reasons.push('inferior-to-sbmx-buy-and-hold');
if (combined.result.endingLiquidationValue <= combined.sbmmBuyAndHold) reasons.push('inferior-to-sbmm-cash-sleeve');
const report = {
  experiment: 'lkoh-sbmx-relative-lag-v1',
  protocolSha256,
  lkohSourceSha256: lkohSource.rowsSha256,
  sbmxSourceSha256: sbmxSource.rowsSha256,
  sbmmSourceSha256: sbmmSource.rowsSha256,
  breakevenRatio: sbgbSbmmBreakevenRatio,
  discovery,
  validation,
  combined,
  years,
  status: reasons.length ? 'not-admitted' : 'requires-execution-and-rights-audit-not-tradeable',
  reasons,
};
writeFileSync('.trading/lkoh-sbmx-relative-lag-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
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
  lkohBuyAndHold: period.lkohBuyAndHold,
  sbmxBuyAndHold: period.sbmxBuyAndHold,
  sbmmBuyAndHold: period.sbmmBuyAndHold,
});
console.log(JSON.stringify({
  experiment: report.experiment,
  protocolSha256,
  lkohSourceSha256: lkohSource.rowsSha256,
  discovery: summary(discovery),
  validation: summary(validation),
  combined: summary(combined),
  years,
  status: report.status,
  reasons,
}, null, 2));
