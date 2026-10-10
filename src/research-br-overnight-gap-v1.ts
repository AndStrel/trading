import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { br2025DaySpecs, readCachedBr2025Day } from './research-br-2025-source.js';
import { br2026DaySpecs, readCachedBrDay } from './research-br-2026-source.js';
import { evaluateBrOvernightGap, type BrOvernightGapDecision } from './research/br-overnight-gap.js';

type Spec = { date: string; contract: string; year: number; candles: () => ReturnType<typeof readCachedBrDay>['candles'] };
type Decision = BrOvernightGapDecision | { date: string; contract: string; status: 'special_session' | 'no_session' | 'no_previous_source_session' | 'contract_roll' };
const hash = (body: string | Buffer) => createHash('sha256').update(body).digest('hex');
const source2025Sha256 = hash(readFileSync(join(process.cwd(), '.trading', 'br-2025-continuous-source.json')));
const source2026Sha256 = hash(readFileSync(join(process.cwd(), '.trading', 'br-2026-continuous-source.json')));
if (source2025Sha256 !== '0accb82bf1f5ac7808df713620cab57a4217e440d9a369f4817c863476f95969' ||
    source2026Sha256 !== 'd8721ce74334619fc1c7f6f960a85d6e77e7ddcb050958163a9b9d8081caf57a') {
  throw new Error('Locked BR source changed');
}
const protocolSha256 = hash(readFileSync(join(process.cwd(), 'docs', 'BR_OVERNIGHT_GAP_CONTINUATION_V1.md')));
if (protocolSha256 !== 'b49b44521d7b33374b449aba5c28172cd4bc98b88f4043c651dbea693d4f8de0') {
  throw new Error('Locked BR overnight-gap protocol changed');
}

const noSessionDates = new Set(['2025-05-01', '2025-05-09', '2025-06-12']);
const special2026Dates = new Set(['2026-05-01', '2026-06-12']);
const sourceSpecs: Spec[] = [
  ...br2025DaySpecs().map((spec) => ({ ...spec, year: 2025, candles: () => readCachedBr2025Day(spec).candles })),
  ...br2026DaySpecs().map((spec) => ({ ...spec, year: 2026, candles: () => readCachedBrDay(spec).candles })),
];
const decisions: Decision[] = [];
for (const year of [2025, 2026]) {
  const specs = sourceSpecs.filter((spec) => spec.year === year);
  const sessions = specs.filter((spec) => !(year === 2025 && noSessionDates.has(spec.date)));
  for (const spec of specs) {
    if (year === 2025 && noSessionDates.has(spec.date)) {
      decisions.push({ date: spec.date, contract: spec.contract, status: 'no_session' });
      continue;
    }
    if (year === 2026 && special2026Dates.has(spec.date)) {
      decisions.push({ date: spec.date, contract: spec.contract, status: 'special_session' });
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
    const previousCandles = previous.candles();
    const previousClose = previousCandles.find((candle) => candle.time === `${previous.date} 16:59:00`)?.close;
    decisions.push(evaluateBrOvernightGap(spec.date, spec.contract, previousClose, spec.candles()));
  }
}

function summarize(rows: readonly Decision[]) {
  const trades = rows.filter((row): row is BrOvernightGapDecision => row.status === 'trade');
  const base = trades.map((row) => row.baseNet!);
  const stress = trades.map((row) => row.stressNet!);
  const gross = trades.map((row) => row.gross!);
  const positive = base.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const negative = base.filter((value) => value < 0).reduce((sum, value) => sum - value, 0);
  const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  return {
    sourceDates: rows.length,
    noSessions: rows.filter((row) => row.status === 'no_session').length,
    specialSessions: rows.filter((row) => row.status === 'special_session').length,
    noPreviousSourceSession: rows.filter((row) => row.status === 'no_previous_source_session').length,
    contractRolls: rows.filter((row) => row.status === 'contract_roll').length,
    missingGapReference: rows.filter((row) => row.status === 'missing_gap_reference').length,
    cancelledEntries: rows.filter((row) => row.status === 'cancelled_entry').length,
    unresolvedExits: rows.filter((row) => row.status === 'unresolved_exit').length,
    cash: rows.filter((row) => row.status === 'cash').length,
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
}

const combined = summarize(decisions);
const byYear = Object.fromEntries([2025, 2026].map((year) => [String(year), summarize(decisions.filter((row) => row.date.startsWith(String(year))))]));
const gatePass = combined.trades >= 100 && combined.cancelledEntries === 0 && combined.unresolvedExits === 0 &&
  combined.baseWinRate !== null && combined.baseWinRate >= 0.51 && combined.meanBase !== null && combined.meanBase > 0 &&
  combined.meanStress !== null && combined.meanStress > 0 && combined.profitFactor !== null && combined.profitFactor > 1 &&
  combined.baseSumWithoutBest !== null && combined.baseSumWithoutBest > 0 &&
  Object.values(byYear).every((year) => year.trades > 0 && year.baseWinRate !== null && year.baseWinRate >= 0.51 &&
    year.meanBase !== null && year.meanBase > 0 && year.meanStress !== null && year.meanStress > 0);
const report = { protocolSha256, sourceReportSha256: { 2025: source2025Sha256, 2026: source2026Sha256 }, gatePass, combined, byYear, decisions };
const body = `${JSON.stringify(report, null, 2)}\n`;
const output = join(process.cwd(), '.trading', 'br-overnight-gap-continuation-v1.json');
writeFileSync(output, body, { mode: 0o600 });
console.log(JSON.stringify({ output, sha256: hash(body), gatePass, combined, byYear }));
