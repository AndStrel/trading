import { readFileSync, writeFileSync } from 'node:fs';
import { digest } from './research/verified-candles.js';
import {
  controlBlocksSpecificity,
  flowGateReasons,
  simulateStructuralFlows,
  type FlowTrade,
} from './research/structural-flow.js';
import type { DailyBar } from './research/weekly-trend.js';

const protocolSha256 = digest(readFileSync('docs/STRUCTURAL_FLOW_V1.md'));
if (protocolSha256 !== '6866e86e3036d2444cd99149516746204d2eb3bf455f22c7c2bb0dd211919139') throw new Error('Frozen structural-flow protocol changed');

const sbmxSource = JSON.parse(readFileSync('.trading/sbmx-daily-2021-2025.json', 'utf8')) as {
  rowsSha256: string;
  rows: DailyBar[];
};
const sbmmSource = JSON.parse(readFileSync('.trading/sbmm-daily-2021-2025.json', 'utf8')) as {
  rowsSha256: string;
  rows: DailyBar[];
};
if (sbmxSource.rowsSha256 !== '31e0501946b7e733d35f4138d196d3e191e1513e9ebfa385bce68a87f901f6ed') {
  throw new Error('Frozen SBMX source changed');
}
if (sbmmSource.rowsSha256 !== '79be545eefeb2305911e631e15cadcb93a3bde2f514023a5bcd4284945dda016') {
  throw new Error('Frozen SBMM source changed');
}

function summarize(trades: FlowTrade[]) {
  const completed = trades.filter((trade) => trade.status === 'trade');
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const nets = completed.map((trade) => trade.sbmxNetPct!);
  const gains = nets.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const losses = nets.filter((value) => value < 0).reduce((sum, value) => sum + Math.abs(value), 0);
  let ending = 1_000_000;
  for (const trade of completed) ending *= 1 + trade.sbmxNetPct! / 100;
  return {
    scheduled: trades.length,
    trades: completed.length,
    unresolved: trades.length - completed.length,
    winners: nets.filter((value) => value > 0).length,
    winRate: completed.length === 0 ? null : nets.filter((value) => value > 0).length / completed.length,
    meanNetPct: completed.length === 0 ? null : mean(nets),
    meanStressPct: completed.length === 0 ? null : mean(completed.map((trade) => trade.sbmxStressPct!)),
    meanExcessPct: completed.length === 0 ? null : mean(completed.map((trade) => trade.excessPct!)),
    profitFactor: losses === 0 ? null : gains / losses,
    endingLiquidationValue: ending,
    unresolvedDays: trades.filter((trade) => trade.status === 'unresolved').map((trade) => trade.anchorDay),
    events: completed.map((trade) => ({
      anchorDay: trade.anchorDay,
      entryDay: trade.entryDay,
      exitDay: trade.exitDay,
      sbmxNetPct: trade.sbmxNetPct,
      excessPct: trade.excessPct,
    })),
  };
}

const flows = simulateStructuralFlows(sbmxSource.rows, sbmmSource.rows);
const expirationReasons = flowGateReasons(flows.expiration, 14);
const turnReasons = flowGateReasons(flows.turnOfMonth, 40);
const controlReasons = flowGateReasons(flows.control, 24);
const expirationSpecific = expirationReasons.length === 0 && !controlBlocksSpecificity(controlReasons);
const report = {
  experiment: 'structural-flow-v1',
  protocolSha256,
  sbmxSourceSha256: sbmxSource.rowsSha256,
  sbmmSourceSha256: sbmmSource.rowsSha256,
  ignoredAfter: '2025-12-30',
  expiration: { ...summarize(flows.expiration), reasons: expirationReasons, specific: expirationSpecific },
  turnOfMonth: { ...summarize(flows.turnOfMonth), reasons: turnReasons },
  control: { ...summarize(flows.control), reasons: controlReasons, blocksSpecificity: controlBlocksSpecificity(controlReasons) },
  expirationStatus: expirationSpecific ? 'requires-execution-and-rights-audit-not-tradeable' : 'not-admitted',
  turnOfMonthStatus: turnReasons.length === 0 ? 'requires-execution-and-rights-audit-not-tradeable' : 'not-admitted',
};
writeFileSync('.trading/structural-flow-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({
  expiration: { ...report.expiration, events: undefined },
  turnOfMonth: { ...report.turnOfMonth, events: undefined },
  control: { ...report.control, events: undefined },
  expirationStatus: report.expirationStatus,
  turnOfMonthStatus: report.turnOfMonthStatus,
}, null, 2));
