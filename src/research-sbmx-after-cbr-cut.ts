import { readFileSync, writeFileSync } from 'node:fs';
import { digest } from './research/verified-candles.js';
import { CBR_DECISION_DATES } from './research/cbr-sber-reaction.js';
import { simulateSbgbAfterCbrCut, type CutEventResult } from './research/sbgb-after-cbr-cut.js';
import type { DailyBar } from './research/weekly-trend.js';

const protocolSha256 = digest(readFileSync('docs/SBMX_AFTER_CBR_CUT_V1.md'));
if (protocolSha256 !== '27cc80c596b5708fe40281bc330bbb5568d8f4dc0a18c4a89eaf971c799fe86e') {
  throw new Error('Frozen SBMX-after-CBR-cut protocol changed');
}
const ratesSource = JSON.parse(readFileSync('.trading/cbr-keyrate-2015-2025.json', 'utf8')) as {
  rowsSha256: string;
  rates: { day: string; rate: number }[];
};
if (ratesSource.rowsSha256 !== '91da3d92eaef46b4631f2504aee49dc47aa6520b05681e221b9aa35c90d82620' ||
  digest(JSON.stringify(ratesSource.rates)) !== ratesSource.rowsSha256) {
  throw new Error('Frozen CBR key-rate series changed');
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

function stats(events: CutEventResult[]) {
  const trades = events.filter((event) => event.status === 'trade');
  const nets = trades.map((event) => event.sbgbNetPct!);
  const excess = trades.map((event) => event.excessPct!);
  const stress = trades.map((event) => event.sbgbStressPct!);
  const mean = (values: number[]) =>
    values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
  const winners = nets.filter((value) => value > 0).length;
  const losses = nets.filter((value) => value < 0).reduce((sum, value) => sum + Math.abs(value), 0);
  const gains = nets.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  return {
    events: events.length,
    trades: trades.length,
    unresolved: events.filter((event) => event.status === 'unresolved').length,
    skippedOpen: events.filter((event) => event.status === 'skipped-open').length,
    cuts: events.filter((event) => event.move === 'cut').length,
    winners,
    winRate: trades.length === 0 ? null : winners / trades.length,
    meanNetPct: mean(nets),
    meanStressPct: mean(stress),
    meanExcessPct: mean(excess),
    profitFactor: losses === 0 ? (gains > 0 ? null : 0) : gains / losses,
    withoutBestThreeSumPct: [...nets].sort((a, b) => b - a).slice(3).reduce((sum, value) => sum + value, 0),
  };
}

function run(from: string, thru: string) {
  const events = simulateSbgbAfterCbrCut({
    rates: ratesSource.rates,
    decisions: [...CBR_DECISION_DATES],
    sbgb: sbmxSource.rows,
    sbmm: sbmmSource.rows,
    from,
    thru,
    requiredMove: 'cut',
  });
  return { from, thru, events, stats: stats(events) };
}

const discovery = run('2021-01-01', '2023-12-31');
const validation = run('2024-01-01', '2025-12-31');
const combined = run('2021-01-01', '2025-12-31');
const reasons: string[] = [];
const profitFactorPasses = (value: ReturnType<typeof stats>) =>
  (value.profitFactor !== null && value.profitFactor > 1) ||
  (value.profitFactor === null && value.trades > 0 && value.winners === value.trades);
if (combined.stats.trades < 20) reasons.push('insufficient-combined-sample');
for (const period of [discovery, validation, combined]) {
  const { stats: s } = period;
  if (
    s.winRate === null ||
    s.winRate < 0.51 ||
    s.meanNetPct === null ||
    s.meanNetPct <= 0 ||
    s.meanStressPct === null ||
    s.meanStressPct <= 0 ||
    s.meanExcessPct === null ||
    s.meanExcessPct <= 0 ||
    !profitFactorPasses(s) ||
    s.withoutBestThreeSumPct <= 0
  ) {
    reasons.push(`failed-${period.from}-gate`);
  }
}
const report = {
  experiment: 'sbmx-after-cbr-cut-v1',
  protocolSha256,
  rateSha256: ratesSource.rowsSha256,
  sbmxSourceSha256: sbmxSource.rowsSha256,
  sbmmSourceSha256: sbmmSource.rowsSha256,
  discovery,
  validation,
  combined,
  status: reasons.length ? 'not-admitted' : 'requires-execution-and-rights-audit-not-tradeable',
  reasons,
};
writeFileSync('.trading/sbmx-after-cbr-cut-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({
  experiment: report.experiment,
  protocolSha256,
  discovery: discovery.stats,
  validation: validation.stats,
  combined: combined.stats,
  status: report.status,
  reasons,
}, null, 2));
