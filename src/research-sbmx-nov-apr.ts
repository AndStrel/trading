import { readFileSync, writeFileSync } from 'node:fs';
import { digest } from './research/verified-candles.js';
import { simulateSbmxNovApr, type WinterTrade } from './research/sbmx-nov-apr.js';
import type { DailyBar } from './research/weekly-trend.js';

const protocolSha256 = digest(readFileSync('docs/SBMX_NOV_APR_V1.md'));
if (protocolSha256 !== 'ddef90582661cbb15ca9cfc30250bc3ca4fab9d6067de32de1fea794e602b5d1') {
  throw new Error('Frozen SBMX Nov-Apr protocol changed');
}
const sbmxSource = JSON.parse(readFileSync('.trading/sbmx-daily-2021-2025.json', 'utf8')) as {
  rowsSha256: string;
  rows: DailyBar[];
};
const sbmmSource = JSON.parse(readFileSync('.trading/sbmm-daily-2021-2025.json', 'utf8')) as {
  rowsSha256: string;
  rows: DailyBar[];
};
if (sbmxSource.rowsSha256 !== '5f1f0e533a4bfc05d88014b3052245ffb55b430faebb9a23289521672effe64b') {
  throw new Error('Frozen SBMX source changed');
}
if (sbmmSource.rowsSha256 !== '6a70207aa52c48b620597cacadaab117de9d858711a1fae5047f2f075b88eca3') {
  throw new Error('Frozen SBMM source changed');
}

function stats(winters: WinterTrade[]) {
  const trades = winters.filter((winter) => winter.status === 'trade');
  const nets = trades.map((trade) => trade.sbmxNetPct!);
  const excess = trades.map((trade) => trade.excessPct!);
  const stress = trades.map((trade) => trade.sbmxStressPct!);
  const mean = (values: number[]) =>
    values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
  const winners = nets.filter((value) => value > 0).length;
  const losses = nets.filter((value) => value < 0).reduce((sum, value) => sum + Math.abs(value), 0);
  const gains = nets.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  return {
    winters: winters.length,
    trades: trades.length,
    unresolved: winters.filter((winter) => winter.status === 'unresolved').length,
    winners,
    winRate: trades.length === 0 ? null : winners / trades.length,
    meanNetPct: mean(nets),
    meanStressPct: mean(stress),
    meanExcessPct: mean(excess),
    profitFactor: losses === 0 ? (gains > 0 ? null : 0) : gains / losses,
  };
}

function run(years: number[]) {
  const result = simulateSbmxNovApr(sbmxSource.rows, sbmmSource.rows, years);
  return { years, ...result, stats: stats(result.winters) };
}

const discovery = run([2021, 2022]);
const validation = run([2023, 2024]);
const combined = run([2021, 2022, 2023, 2024]);
const reasons: string[] = [];
const profitFactorPasses = (value: ReturnType<typeof stats>) =>
  (value.profitFactor !== null && value.profitFactor > 1) ||
  (value.profitFactor === null && value.trades > 0 && value.winners === value.trades);
if (combined.stats.trades !== 4 || combined.stats.unresolved !== 0) reasons.push('incomplete-four-winters');
for (const period of [discovery, validation, combined]) {
  const { stats: s } = period;
  if (
    s.meanNetPct === null ||
    s.meanNetPct <= 0 ||
    s.meanStressPct === null ||
    s.meanStressPct <= 0 ||
    s.meanExcessPct === null ||
    s.meanExcessPct <= 0
  ) {
    reasons.push(`failed-${period.years[0]}-mean-gate`);
  }
}
if (
  combined.stats.winRate === null ||
  combined.stats.winRate < 0.51 ||
  !profitFactorPasses(combined.stats)
) {
  reasons.push('failed-combined-win-gate');
}
if (combined.sbmxHold === null || combined.endingLiquidationValue <= combined.sbmxHold) {
  reasons.push('inferior-to-sbmx-buy-and-hold');
}
if (combined.sbmmHold === null || combined.endingLiquidationValue <= combined.sbmmHold) {
  reasons.push('inferior-to-sbmm-buy-and-hold');
}
const report = {
  experiment: 'sbmx-nov-apr-v1',
  protocolSha256,
  sbmxSourceSha256: sbmxSource.rowsSha256,
  sbmmSourceSha256: sbmmSource.rowsSha256,
  discovery,
  validation,
  combined,
  status: reasons.length ? 'not-admitted' : 'requires-execution-and-rights-audit-not-tradeable',
  reasons,
};
writeFileSync('.trading/sbmx-nov-apr-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({
  experiment: report.experiment,
  protocolSha256,
  discovery: { stats: discovery.stats, ending: discovery.endingLiquidationValue },
  validation: { stats: validation.stats, ending: validation.endingLiquidationValue },
  combined: {
    stats: combined.stats,
    ending: combined.endingLiquidationValue,
    sbmxHold: combined.sbmxHold,
    sbmmHold: combined.sbmmHold,
    winters: combined.trades.map((trade) => ({
      entryYear: trade.entryYear,
      entryDay: trade.entryDay,
      exitDay: trade.exitDay,
      sbmxNetPct: trade.sbmxNetPct,
      excessPct: trade.excessPct,
    })),
  },
  status: report.status,
  reasons,
}, null, 2));
