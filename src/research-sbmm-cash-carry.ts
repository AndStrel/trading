import { readFileSync, writeFileSync } from 'node:fs';
import { digest } from './research/verified-candles.js';
import { relativeStats } from './research/weekly-relative-strength.js';
import { auditWeeklyPortfolio } from './research/weekly-portfolio-risk.js';
import { breakevenRatio, buyAndHoldLqdt, simulateWeeklyLqdtCarry } from './research/weekly-lqdt-carry.js';
import type { DailyBar } from './research/weekly-trend.js';

const protocolSha256 = digest(readFileSync('docs/SBMM_CASH_CARRY_TRANSFER_V1.md'));
if (protocolSha256 !== '024e92605af8de3dd70d17d08dfa3338a355eeac346c7118ec6258893ffdecd0') {
  throw new Error('Frozen SBMM transfer protocol changed');
}
const source = JSON.parse(readFileSync('.trading/sbmm-daily-2021-2025.json', 'utf8')) as {
  rowsSha256: string;
  rows: DailyBar[];
  coverage: { year: number; count: number }[];
};
if (source.rowsSha256 !== '6a70207aa52c48b620597cacadaab117de9d858711a1fae5047f2f075b88eca3' ||
  digest(JSON.stringify(source.rows)) !== source.rowsSha256) {
  throw new Error('Frozen SBMM source changed');
}
if (source.coverage.filter((year) => year.year >= 2023).some((year) => year.count < 150)) {
  throw new Error('SBMM 2023-2025 coverage below the frozen floor');
}

function run(from: string, thru: string) {
  const result = simulateWeeklyLqdtCarry(source.rows, from, thru, 'conditional');
  const bars = source.rows.filter((bar) => bar.day <= thru);
  const portfolio = auditWeeklyPortfolio(bars, result.trades, result.pending, result.endingCash);
  const control = simulateWeeklyLqdtCarry(source.rows, from, thru, 'always-long');
  const controlPortfolio = auditWeeklyPortfolio(bars, control.trades, control.pending, control.endingCash);
  const buyAndHold = buyAndHoldLqdt(source.rows, from, thru);
  const buyAndHoldPortfolio = auditWeeklyPortfolio(
    bars,
    [
      {
        entryDay: buyAndHold.entryDay,
        exitDay: buyAndHold.finalDay,
        entry: buyAndHold.entry,
        principal: 1_000_000,
        proceeds: buyAndHold.endingLiquidationValue,
      },
    ],
    [],
    buyAndHold.endingLiquidationValue,
  );
  return {
    from,
    thru,
    result,
    stats: relativeStats(result.trades),
    stressWinners: result.trades.filter((trade) => trade.stressPct > 0).length,
    portfolio,
    control: { stats: relativeStats(control.trades), portfolio: controlPortfolio },
    buyAndHold,
    buyAndHoldPortfolio,
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
for (const period of [discovery, validation]) {
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
    reasons.push(`failed-${period.from}-gate`);
  }
}
if (years.some((year) => year.trades === 0 || year.meanNetPct === null || year.meanNetPct <= 0)) {
  reasons.push('failed-year-gate');
}
if (
  combined.stats.winRate === null ||
  combined.stats.winRate < 0.51 ||
  combined.stats.meanNetPct === null ||
  combined.stats.meanNetPct <= 0 ||
  combined.stats.stressMeanPct === null ||
  combined.stats.stressMeanPct <= 0 ||
  !profitFactorPasses(combined.stats) ||
  combined.stats.withoutBestFiveSumPct <= 0 ||
  combined.portfolio.activeWeekWinRate === null ||
  combined.portfolio.activeWeekWinRate < 0.51 ||
  combined.result.endingLiquidationValue <= 1_000_000
) {
  reasons.push('failed-combined-gate');
}
if (combined.result.endingLiquidationValue <= combined.buyAndHold.endingLiquidationValue) {
  reasons.push('inferior-to-buy-and-hold');
}
const report = {
  experiment: 'sbmm-cash-carry-transfer-v1',
  protocolSha256,
  sourceSha256: source.rowsSha256,
  sourceCoverage: source.coverage,
  breakevenRatio,
  discovery,
  validation,
  combined,
  years,
  status: reasons.length ? 'not-admitted' : 'requires-execution-and-rights-audit-not-tradeable',
  reasons,
};
writeFileSync('.trading/sbmm-cash-carry-transfer-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
const summary = (period: typeof discovery) => ({
  from: period.from,
  thru: period.thru,
  stats: period.stats,
  stressWinners: period.stressWinners,
  pending: period.result.pending.length,
  endingLiquidationValue: period.result.endingLiquidationValue,
  activeWeeks: period.portfolio.activeWeeks,
  positiveActiveWeeks: period.portfolio.positiveActiveWeeks,
  activeWeekWinRate: period.portfolio.activeWeekWinRate,
  maxDrawdownPct: period.portfolio.maxDrawdownPct,
  controlEndingLiquidationValue: period.control.portfolio.endingCloseLiquidationValue,
  buyAndHoldEnding: period.buyAndHold.endingLiquidationValue,
  buyAndHoldActiveWeekWinRate: period.buyAndHoldPortfolio.activeWeekWinRate,
  buyAndHoldMaxDrawdownPct: period.buyAndHoldPortfolio.maxDrawdownPct,
});
console.log(
  JSON.stringify(
    {
      experiment: report.experiment,
      protocolSha256,
      sourceSha256: source.rowsSha256,
      breakevenRatio,
      discovery: summary(discovery),
      validation: summary(validation),
      combined: summary(combined),
      years,
      status: report.status,
      reasons,
    },
    null,
    2,
  ),
);
