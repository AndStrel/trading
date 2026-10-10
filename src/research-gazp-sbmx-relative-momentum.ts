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

const protocolSha256 = digest(readFileSync('docs/GAZP_SBMX_RELATIVE_MOMENTUM_V1.md'));
if (protocolSha256 !== '0d11d1065682eef02dc201313c2eea5f15056dc30010f2ed7d0ecd040afe73bd') {
  throw new Error('Frozen GAZP/SBMX relative-momentum protocol changed');
}
const gazpSource = JSON.parse(readFileSync('.trading/gazp-daily-2015-2025.json', 'utf8')) as {
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
if (digest(JSON.stringify(gazpSource.rows)) !== gazpSource.rowsSha256) throw new Error('GAZP rows hash mismatch');
if (gazpSource.rowsSha256 !== 'd0705203ae7629cc0b919f5b2a6da8b5be333972d8c81aba8bc6d1b13923c261') {
  throw new Error('Frozen GAZP source changed');
}
if (sbmxSource.rowsSha256 !== '5f1f0e533a4bfc05d88014b3052245ffb55b430faebb9a23289521672effe64b') {
  throw new Error('Frozen SBMX source changed');
}
if (sbmmSource.rowsSha256 !== '6a70207aa52c48b620597cacadaab117de9d858711a1fae5047f2f075b88eca3') {
  throw new Error('Frozen SBMM source changed');
}
if (gazpSource.coverage.filter((year) => year.year >= 2023).some((year) => year.count < 150 || year.count > 400)) {
  throw new Error('GAZP 2023-2025 coverage outside 150-400');
}

function holdValue(rows: DailyBar[], from: string, thru: string) {
  return buyAndHoldLqdt(rows, from, thru).endingLiquidationValue;
}

function run(from: string, thru: string) {
  const pair = alignWeekdayBars(
    gazpSource.rows.filter((bar) => bar.day <= thru),
    sbmxSource.rows.filter((bar) => bar.day <= thru),
  );
  const withCash = alignWeekdayBars(pair.left, sbmmSource.rows.filter((bar) => bar.day <= thru));
  const result = simulateSbgbSbmmRelativeLag(gazpSource.rows, sbmxSource.rows, from, thru, 'relative-momentum');
  const control = simulateSbgbSbmmRelativeLag(gazpSource.rows, sbmxSource.rows, from, thru, 'always-long-sbgb');
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
    gazpBuyAndHold: holdValue(pair.left, from, thru),
    sbmxBuyAndHold: holdValue(pair.right, from, thru),
    sbmmBuyAndHold: holdValue(withCash.right, from, thru),
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
if (combined.result.endingLiquidationValue <= combined.gazpBuyAndHold) reasons.push('inferior-to-gazp-buy-and-hold');
if (combined.result.endingLiquidationValue <= combined.sbmxBuyAndHold) reasons.push('inferior-to-sbmx-buy-and-hold');
if (combined.result.endingLiquidationValue <= combined.sbmmBuyAndHold) reasons.push('inferior-to-sbmm-cash-sleeve');
const report = {
  experiment: 'gazp-sbmx-relative-momentum-v1',
  protocolSha256,
  gazpSourceSha256: gazpSource.rowsSha256,
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
writeFileSync('.trading/gazp-sbmx-relative-momentum-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
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
  gazpBuyAndHold: period.gazpBuyAndHold,
  sbmxBuyAndHold: period.sbmxBuyAndHold,
  sbmmBuyAndHold: period.sbmmBuyAndHold,
});
console.log(JSON.stringify({
  experiment: report.experiment,
  protocolSha256,
  gazpSourceSha256: gazpSource.rowsSha256,
  discovery: summary(discovery),
  validation: summary(validation),
  combined: summary(combined),
  years,
  status: report.status,
  reasons,
}, null, 2));
