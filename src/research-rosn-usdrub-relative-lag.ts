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

const protocolSha256 = digest(readFileSync('docs/ROSN_USDRUB_RELATIVE_LAG_V1.md'));
if (protocolSha256 !== '5cac21f1617be27a92e56666895ce699b4de81b90d8791cb6761b49d203d0c0c') {
  throw new Error('Frozen ROSN/USDRUB relative-lag protocol changed');
}
const rosnSource = JSON.parse(readFileSync('.trading/rosn-daily-2021-2025.json', 'utf8')) as {
  rowsSha256: string;
  rows: DailyBar[];
  coverage: { year: number; count: number }[];
};
const usdSource = JSON.parse(readFileSync('.trading/usdrub-tom-daily-2021-2025.json', 'utf8')) as {
  rowsSha256: string;
  rows: DailyBar[];
  coverage: { year: number; count: number }[];
};
const sbmmSource = JSON.parse(readFileSync('.trading/sbmm-daily-2021-2025.json', 'utf8')) as {
  rowsSha256: string;
  rows: DailyBar[];
};
if (digest(JSON.stringify(rosnSource.rows)) !== rosnSource.rowsSha256) throw new Error('ROSN rows hash mismatch');
if (digest(JSON.stringify(usdSource.rows)) !== usdSource.rowsSha256) throw new Error('USD rows hash mismatch');
if (rosnSource.rowsSha256 !== 'PIN_ROSN') throw new Error('Frozen ROSN source changed');
if (usdSource.rowsSha256 !== 'PIN_USD') throw new Error('Frozen USD source changed');
if (sbmmSource.rowsSha256 !== '6a70207aa52c48b620597cacadaab117de9d858711a1fae5047f2f075b88eca3') {
  throw new Error('Frozen SBMM source changed');
}
if (rosnSource.coverage.filter((year) => year.year >= 2023).some((year) => year.count < 150 || year.count > 400)) {
  throw new Error('ROSN 2023-2025 coverage outside 150-400');
}
if (usdSource.coverage.filter((year) => year.year >= 2023).some((year) => year.count < 150 || year.count > 400)) {
  throw new Error('USD 2023-2025 coverage outside 150-400');
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
    rosnSource.rows.filter((bar) => bar.day <= thru),
    usdSource.rows.filter((bar) => bar.day <= thru),
  );
  const withCash = alignWeekdayBars(pair.left, sbmmSource.rows.filter((bar) => bar.day <= thru));
  const result = simulateSbgbSbmmRelativeLag(rosnSource.rows, usdSource.rows, from, thru, 'relative-lag');
  const control = simulateSbgbSbmmRelativeLag(rosnSource.rows, usdSource.rows, from, thru, 'always-long-sbgb');
  const portfolio = auditWeeklyPortfolio(pair.left, result.trades, result.pending, result.endingCash);
  const rosnHold = holdStats(pair.left, from, thru);
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
    rosnBuyAndHold: rosnHold.hold.endingLiquidationValue,
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
if (combined.result.endingLiquidationValue <= combined.rosnBuyAndHold) reasons.push('inferior-to-rosn-buy-and-hold');
if (combined.result.endingLiquidationValue <= combined.sbmmBuyAndHold) reasons.push('inferior-to-sbmm-cash-sleeve');
const report = {
  experiment: 'rosn-usdrub-relative-lag-v1',
  protocolSha256,
  rosnSourceSha256: rosnSource.rowsSha256,
  usdSourceSha256: usdSource.rowsSha256,
  sbmmSourceSha256: sbmmSource.rowsSha256,
  breakevenRatio: sbgbSbmmBreakevenRatio,
  discovery,
  validation,
  combined,
  years,
  status: reasons.length ? 'not-admitted' : 'requires-execution-and-rights-audit-not-tradeable',
  reasons,
};
writeFileSync('.trading/rosn-usdrub-relative-lag-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
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
  sbmmBuyAndHold: period.sbmmBuyAndHold,
});
console.log(JSON.stringify({
  experiment: report.experiment,
  protocolSha256,
  rosnSourceSha256: rosnSource.rowsSha256,
  usdSourceSha256: usdSource.rowsSha256,
  discovery: summary(discovery),
  validation: summary(validation),
  combined: summary(combined),
  years,
  status: report.status,
  reasons,
}, null, 2));
