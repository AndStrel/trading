import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { br2026DaySpecs, readCachedBrDay } from './research-br-2026-source.js';
import { evaluateSiOpeningBreakout, type OpeningBreakoutDecision } from './research/si-opening-breakout.js';
import { siTradeReturn } from './research/si-first-hour.js';

const hash = (body: string | Buffer) => createHash('sha256').update(body).digest('hex');
const sourceReportSha256 = hash(readFileSync(join(process.cwd(), '.trading', 'br-2026-continuous-source.json')));
if (sourceReportSha256 !== 'd8721ce74334619fc1c7f6f960a85d6e77e7ddcb050958163a9b9d8081caf57a') {
  throw new Error('Locked BR source changed');
}
const protocolSha256 = hash(readFileSync(join(process.cwd(), 'docs', 'BR_OPENING_COMPRESSION_TRANSFER_V1.md')));
const specialDates = new Set(['2026-05-01', '2026-06-12']);
const decisions = br2026DaySpecs().map((spec) => specialDates.has(spec.date)
  ? { date: spec.date, contract: spec.contract, status: 'special_session' as const }
  : evaluateSiOpeningBreakout(spec.date, spec.contract, readCachedBrDay(spec).candles));
const ordinary = decisions.filter((row): row is OpeningBreakoutDecision => row.status !== 'special_session');

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
  return { dates: rows.length, missingOpening: rows.filter((row) => row.status === 'missing_opening' || row.status === 'no_candles').length,
    cash: rows.filter((row) => row.status === 'cash').length,
    cancelled: rows.filter((row) => row.status === 'cancelled_entry').length,
    unresolved: rows.filter((row) => row.status === 'unresolved_holding').length,
    ambiguous: rows.filter((row) => row.status === 'ambiguous_signal').length,
    trades: trades.length, longTrades: trades.filter((row) => row.side === 'long').length,
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
    profitFactor: negative > 0 ? positive / negative : null,
    withoutBestTradeSum: base.length ? base.reduce((sum, value) => sum + value, 0) - Math.max(...base) : null };
}
const combined = summarize(ordinary);
const marchMay = summarize(ordinary.filter((row) => row.date < '2026-06-01'));
const juneSeptember = summarize(ordinary.filter((row) => row.date >= '2026-06-01'));
const gatePass = combined.trades >= 100 && combined.cancelled === 0 && combined.unresolved === 0 &&
  combined.baseWinRate !== null && combined.baseWinRate >= 0.51 &&
  combined.meanBase !== null && combined.meanBase > 0 &&
  combined.meanStress !== null && combined.meanStress > 0 &&
  combined.profitFactor !== null && combined.profitFactor > 1 &&
  combined.withoutBestTradeSum !== null && combined.withoutBestTradeSum > 0 &&
  [marchMay, juneSeptember].every((block) => block.trades > 0 && block.baseWinRate !== null &&
    block.baseWinRate >= 0.51 && block.meanBase !== null && block.meanBase > 0 &&
    block.meanStress !== null && block.meanStress > 0);
const report = { protocolSha256, sourceReportSha256, gatePass, combined, marchMay, juneSeptember, decisions };
const body = `${JSON.stringify(report, null, 2)}\n`;
const output = join(process.cwd(), '.trading', 'br-opening-compression-transfer-v1.json');
writeFileSync(output, body, { mode: 0o600 });
process.stdout.write(`${JSON.stringify({ output, sha256: hash(body), gatePass, combined, marchMay, juneSeptember })}\n`);
