import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { br2024DaySpecs, readCachedBr2024Day } from './research-br-2024-source.js';
import { evaluateBrOvernightGap, type BrOvernightGapDecision } from './research/br-overnight-gap.js';

type Decision = BrOvernightGapDecision | { date: string; contract: string; status: 'no_session' | 'no_previous_source_session' | 'contract_roll' };
const hash = (body: string | Buffer) => createHash('sha256').update(body).digest('hex');
const sourceSha256 = hash(readFileSync(join(process.cwd(), '.trading', 'br-2024-continuous-source.json')));
if (sourceSha256 !== '49fe00ecb754dbb7af599a1765cbc7b762b2a4189da68a4b70124f9304fd7494') {
  throw new Error('Locked BR 2024 source changed');
}
const protocolSha256 = hash(readFileSync(join(process.cwd(), 'docs', 'BR_OVERNIGHT_GAP_FADE_2024_V1.md')));
if (protocolSha256 !== 'aa910d38dd382a2b8003c827d13dd7a5e399cf4a8c6b8dd94bd2455e037ee96e') {
  throw new Error('Locked 2024 gap-fade protocol changed');
}

const noSessionDates = new Set(['2024-02-23', '2024-03-08', '2024-05-01', '2024-05-09', '2024-06-12']);
const specs = br2024DaySpecs();
const sessions = specs.filter((spec) => !noSessionDates.has(spec.date));
const decisions: Decision[] = [];
for (const spec of specs) {
  if (noSessionDates.has(spec.date)) {
    decisions.push({ date: spec.date, contract: spec.contract, status: 'no_session' });
    continue;
  }
  const index = sessions.findIndex((session) => session.date === spec.date);
  const previous = index > 0 ? sessions[index - 1] : undefined;
  if (!previous) {
    decisions.push({ date: spec.date, contract: spec.contract, status: 'no_previous_source_session' });
    continue;
  }
  if (previous.contract !== spec.contract) {
    decisions.push({ date: spec.date, contract: spec.contract, status: 'contract_roll' });
    continue;
  }
  const previousCandles = readCachedBr2024Day(previous).candles;
  const previousClose = previousCandles.find((candle) => candle.time === `${previous.date} 16:59:00`)?.close;
  decisions.push(evaluateBrOvernightGap(spec.date, spec.contract, previousClose, readCachedBr2024Day(spec).candles, 'fade'));
}

const trades = decisions.filter((row): row is BrOvernightGapDecision => row.status === 'trade');
const base = trades.map((row) => row.baseNet!);
const stress = trades.map((row) => row.stressNet!);
const gross = trades.map((row) => row.gross!);
const positive = base.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
const negative = base.filter((value) => value < 0).reduce((sum, value) => sum - value, 0);
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const summary = {
  sourceDates: decisions.length,
  noSessions: decisions.filter((row) => row.status === 'no_session').length,
  noPreviousSourceSession: decisions.filter((row) => row.status === 'no_previous_source_session').length,
  contractRolls: decisions.filter((row) => row.status === 'contract_roll').length,
  missingGapReference: decisions.filter((row) => row.status === 'missing_gap_reference').length,
  cancelledEntries: decisions.filter((row) => row.status === 'cancelled_entry').length,
  unresolvedExits: decisions.filter((row) => row.status === 'unresolved_exit').length,
  cash: decisions.filter((row) => row.status === 'cash').length,
  trades: trades.length,
  longTrades: trades.filter((row) => row.side === 'long').length,
  shortTrades: trades.filter((row) => row.side === 'short').length,
  stopExits: trades.filter((row) => row.exitReason === 'stop').length,
  targetExits: trades.filter((row) => row.exitReason === 'target').length,
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
};
const gatePass = summary.trades >= 100 && summary.cancelledEntries === 0 && summary.unresolvedExits === 0 &&
  summary.baseWinRate !== null && summary.baseWinRate >= 0.51 && summary.meanBase !== null && summary.meanBase > 0 &&
  summary.meanStress !== null && summary.meanStress > 0 && summary.profitFactor !== null && summary.profitFactor > 1 &&
  summary.baseSumWithoutBest !== null && summary.baseSumWithoutBest > 0;
const report = { protocolSha256, sourceSha256, gatePass, summary, decisions };
const body = `${JSON.stringify(report, null, 2)}\n`;
const output = join(process.cwd(), '.trading', 'br-overnight-gap-fade-2024-v1.json');
writeFileSync(output, body, { mode: 0o600 });
console.log(JSON.stringify({ output, sha256: hash(body), gatePass, summary }));
