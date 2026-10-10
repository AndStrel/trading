import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { br2025DaySpecs, readCachedBr2025Day } from './research-br-2025-source.js';
import { evaluateSiOpeningBreakout, type OpeningBreakoutDecision } from './research/si-opening-breakout.js';
import { siTradeReturn } from './research/si-first-hour.js';

const hash = (body: string | Buffer) => createHash('sha256').update(body).digest('hex');
const sourceReportSha256 = hash(readFileSync(join(process.cwd(), '.trading', 'br-2025-continuous-source.json')));
if (sourceReportSha256 !== '0accb82bf1f5ac7808df713620cab57a4217e440d9a369f4817c863476f95969') {
  throw new Error('Locked BR 2025 source changed');
}
const protocolSha256 = hash(readFileSync(join(process.cwd(), 'docs', 'BR_OPENING_COMPRESSION_2025_OOS_V1.md')));
if (protocolSha256 !== '20286faa33a2c301e41326b0692ed294a0b706ee121578a68dffe5bf7ba28acc') {
  throw new Error('Locked BR 2025 protocol changed');
}
const noSessionDates = new Set(['2025-05-01', '2025-05-09', '2025-06-12']);
const decisions = br2025DaySpecs().map((spec) => noSessionDates.has(spec.date)
  ? { date: spec.date, contract: spec.contract, status: 'no_session' as const }
  : evaluateSiOpeningBreakout(spec.date, spec.contract, readCachedBr2025Day(spec).candles));
const sessions = decisions.filter((row): row is OpeningBreakoutDecision => row.status !== 'no_session');

function summarize(rows: readonly OpeningBreakoutDecision[]) {
  const trades = rows.filter((row) => row.status === 'trade');
  const values = (key: 'gross' | 'baseNet' | 'stressNet') => trades.map((row) => key === 'gross'
    ? siTradeReturn(row.side!, row.entry!, row.exit!, { commission: 0, slippage: 0 }) : row[key]!);
  const gross = values('gross');
  const base = values('baseNet');
  const stress = values('stressNet');
  const positive = base.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const negative = base.filter((value) => value < 0).reduce((sum, value) => sum - value, 0);
  const mean = (v: number[]) => v.length ? v.reduce((sum, value) => sum + value, 0) / v.length : null;
  return {
    sessions: rows.length,
    missingOpening: rows.filter((row) => row.status === 'missing_opening' || row.status === 'no_candles').length,
    cash: rows.filter((row) => row.status === 'cash').length,
    cancelled: rows.filter((row) => row.status === 'cancelled_entry').length,
    unresolved: rows.filter((row) => row.status === 'unresolved_holding').length,
    ambiguous: rows.filter((row) => row.status === 'ambiguous_signal').length,
    trades: trades.length,
    longTrades: trades.filter((row) => row.side === 'long').length,
    shortTrades: trades.filter((row) => row.side === 'short').length,
    stops: trades.filter((row) => row.exitReason === 'stop').length,
    targets: trades.filter((row) => row.exitReason === 'target').length,
    timedExits: trades.filter((row) => row.exitReason === 'time').length,
    grossWinners: gross.filter((value) => value > 0).length,
    baseWinners: base.filter((value) => value > 0).length,
    stressWinners: stress.filter((value) => value > 0).length,
    baseWinRate: base.length ? base.filter((value) => value > 0).length / base.length : null,
    meanGross: mean(gross), meanBase: mean(base), meanStress: mean(stress),
    baseSum: base.reduce((sum, value) => sum + value, 0),
    stressSum: stress.reduce((sum, value) => sum + value, 0),
    profitFactor: negative > 0 ? positive / negative : null,
    withoutBestTradeSum: base.length ? base.reduce((sum, value) => sum + value, 0) - Math.max(...base) : null,
  };
}

const combined = summarize(sessions);
const marchMay = summarize(sessions.filter((row) => row.date < '2025-06-01'));
const juneSeptember = summarize(sessions.filter((row) => row.date >= '2025-06-01'));
const gatePass = combined.trades >= 100 && combined.cancelled === 0 && combined.unresolved === 0 &&
  combined.baseWinRate !== null && combined.baseWinRate >= 0.51 &&
  combined.meanBase !== null && combined.meanBase > 0 && combined.meanStress !== null && combined.meanStress > 0 &&
  combined.profitFactor !== null && combined.profitFactor > 1 &&
  combined.withoutBestTradeSum !== null && combined.withoutBestTradeSum > 0 &&
  [marchMay, juneSeptember].every((block) => block.trades > 0 && block.baseWinRate !== null &&
    block.baseWinRate >= 0.51 && block.meanBase !== null && block.meanBase > 0 &&
    block.meanStress !== null && block.meanStress > 0);
const report = { protocolSha256, sourceReportSha256, noSessionDates: [...noSessionDates], gatePass, combined, marchMay, juneSeptember, decisions };
const body = `${JSON.stringify(report, null, 2)}\n`;
const output = join(process.cwd(), '.trading', 'br-opening-compression-2025-oos-v1.json');
writeFileSync(output, body, { mode: 0o600 });
process.stdout.write(`${JSON.stringify({ output, sha256: hash(body), gatePass, combined, marchMay, juneSeptember })}\n`);
