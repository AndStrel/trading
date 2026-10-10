import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { br2025DaySpecs, readCachedBr2025Day } from './research-br-2025-source.js';
import { br2026DaySpecs, readCachedBrDay } from './research-br-2026-source.js';
import { evaluateBrShockFade, type BrShockFadeDecision } from './research/br-shock-fade.js';

const hash = (body: string | Buffer) => createHash('sha256').update(body).digest('hex');
const source2025Hash = hash(readFileSync(join(process.cwd(), '.trading', 'br-2025-continuous-source.json')));
const source2026Hash = hash(readFileSync(join(process.cwd(), '.trading', 'br-2026-continuous-source.json')));
if (source2025Hash !== '0accb82bf1f5ac7808df713620cab57a4217e440d9a369f4817c863476f95969' ||
    source2026Hash !== 'd8721ce74334619fc1c7f6f960a85d6e77e7ddcb050958163a9b9d8081caf57a') {
  throw new Error('Locked BR source changed');
}
const protocolSha256 = hash(readFileSync(join(process.cwd(), 'docs', 'BR_FIVE_MINUTE_SHOCK_FADE_V1.md')));
if (protocolSha256 !== '2479321ca49984ec3eb070cdfa162ff6c445caa12a5228414f472467a3a44118') {
  throw new Error('Locked BR shock-fade protocol changed');
}

const noSessionDates = new Set(['2025-05-01', '2025-05-09', '2025-06-12', '2026-05-01', '2026-06-12']);
const specs = [
  ...br2025DaySpecs().map((spec) => ({ ...spec, year: 2025, candles: () => readCachedBr2025Day(spec).candles })),
  ...br2026DaySpecs().map((spec) => ({ ...spec, year: 2026, candles: () => readCachedBrDay(spec).candles })),
];
const decisions = specs.map((spec): BrShockFadeDecision => noSessionDates.has(spec.date)
  ? { date: spec.date, contract: spec.contract, status: 'no_session' }
  : evaluateBrShockFade(spec.date, spec.contract, spec.candles()));

function summarize(rows: readonly BrShockFadeDecision[]) {
  const trades = rows.filter((row) => row.status === 'trade');
  const gross = trades.map((row) => row.gross!);
  const base = trades.map((row) => row.baseNet!);
  const stress = trades.map((row) => row.stressNet!);
  const positive = base.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const negative = base.filter((value) => value < 0).reduce((sum, value) => sum - value, 0);
  const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  return {
    sessions: rows.filter((row) => row.status !== 'no_session').length,
    signalDataGaps: rows.filter((row) => row.status === 'signal_data_gap').length,
    signalCoverage: rows.length ? rows.filter((row) => row.status !== 'signal_data_gap' && row.status !== 'no_session').length /
      rows.filter((row) => row.status !== 'no_session').length : null,
    cash: rows.filter((row) => row.status === 'cash').length,
    cancelledEntries: rows.filter((row) => row.status === 'cancelled_entry').length,
    unresolvedExits: rows.filter((row) => row.status === 'unresolved_exit').length,
    trades: trades.length,
    longTrades: trades.filter((row) => row.side === 'long').length,
    shortTrades: trades.filter((row) => row.side === 'short').length,
    targetExits: trades.filter((row) => row.exitReason === 'target').length,
    stopExits: trades.filter((row) => row.exitReason === 'stop').length,
    timedExits: trades.filter((row) => row.exitReason === 'time').length,
    grossWinners: gross.filter((value) => value > 0).length,
    baseWinners: base.filter((value) => value > 0).length,
    stressWinners: stress.filter((value) => value > 0).length,
    baseWinRate: base.length ? base.filter((value) => value > 0).length / base.length : null,
    stressWinRate: stress.length ? stress.filter((value) => value > 0).length / stress.length : null,
    meanGross: mean(gross),
    meanBase: mean(base),
    meanStress: mean(stress),
    baseSum: base.reduce((sum, value) => sum + value, 0),
    stressSum: stress.reduce((sum, value) => sum + value, 0),
    profitFactor: negative ? positive / negative : null,
    baseSumWithoutBest: base.length ? base.reduce((sum, value) => sum + value, 0) - Math.max(...base) : null,
    meanWinBase: mean(base.filter((value) => value > 0)),
    meanLossBase: mean(base.filter((value) => value < 0)),
  };
}

const combined = summarize(decisions);
const byYear = Object.fromEntries([2025, 2026].map((year) => {
  const rows = decisions.filter((row) => row.date.startsWith(String(year)));
  return [String(year), summarize(rows)];
}));
const coveragePass = [2025, 2026].every((year) => byYear[String(year)]!.signalCoverage !== null && byYear[String(year)]!.signalCoverage! >= 0.9);
const periodPass = Object.values(byYear).every((period) => period.trades > 0 && period.baseWinRate !== null &&
  period.baseWinRate >= 0.51 && period.meanBase !== null && period.meanBase > 0 && period.meanStress !== null && period.meanStress > 0);
const gatePass = combined.trades >= 100 && combined.baseWinRate !== null && combined.baseWinRate >= 0.51 &&
  combined.meanBase !== null && combined.meanBase > 0 && combined.meanStress !== null && combined.meanStress > 0 &&
  combined.profitFactor !== null && combined.profitFactor > 1 && combined.baseSumWithoutBest !== null && combined.baseSumWithoutBest > 0 &&
  combined.cancelledEntries === 0 && combined.unresolvedExits === 0 && coveragePass && periodPass;

const report = {
  protocolSha256,
  sourceHashes: { 2025: source2025Hash, 2026: source2026Hash },
  noSessionDates: [...noSessionDates],
  coveragePass,
  periodPass,
  gatePass,
  combined,
  byYear,
  decisions,
};
const body = `${JSON.stringify(report, null, 2)}\n`;
const output = join(process.cwd(), '.trading', 'br-five-minute-shock-fade-v1.json');
writeFileSync(output, body, { mode: 0o600 });
process.stdout.write(`${JSON.stringify({ output, resultSha256: hash(body), gatePass, combined, byYear })}\n`);
