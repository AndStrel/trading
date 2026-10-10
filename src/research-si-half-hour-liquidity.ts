import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readCachedDay, weekdays } from './research-si-first-hour.js';
import { siContractForDate } from './research/si-first-hour.js';
import { evaluateSiHalfHourDay } from './research/si-half-hour-liquidity.js';

const decisions = weekdays().map((date) => {
  const contract = siContractForDate(date);
  if (!contract) throw new Error(`No contract for ${date}`);
  const { candles } = readCachedDay(date, contract);
  const decision = evaluateSiHalfHourDay(date, contract, candles);
  if (date === '2025-11-04' && decision.status !== 'no_candles') throw new Error('Verified no-session day has candles');
  return decision;
});
const trades = decisions.filter((decision) => decision.status === 'trade');
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const summarize = (selection: typeof trades) => ({
  trades: selection.length,
  baseWins: selection.filter((decision) => decision.baseNet! > 0).length,
  stressWins: selection.filter((decision) => decision.stressNet! > 0).length,
  meanGross: mean(selection.map((decision) => decision.gross!)),
  meanBaseNet: mean(selection.map((decision) => decision.baseNet!)),
  meanStressNet: mean(selection.map((decision) => decision.stressNet!)),
});
const summary = {
  dates: decisions.length, missingHistory: decisions.filter((decision) => decision.status === 'missing_history').length,
  noCandles: decisions.filter((decision) => decision.status === 'no_candles').length,
  cash: decisions.filter((decision) => decision.status === 'cash').length,
  cancelledEntry: decisions.filter((decision) => decision.status === 'cancelled_entry').length,
  unresolvedExit: decisions.filter((decision) => decision.status === 'unresolved_exit').length,
  combined: summarize(trades),
  SiU5: summarize(trades.filter((decision) => decision.contract === 'SiU5')),
  SiZ5: summarize(trades.filter((decision) => decision.contract === 'SiZ5')),
};
const report = { protocol: 'docs/SI_HALF_HOUR_LIQUIDITY_V1.md', source: '.trading/si-first-hour-v1/',
  summary, decisions };
const body = `${JSON.stringify(report, null, 2)}\n`;
const path = join(process.cwd(), '.trading', 'si-half-hour-liquidity-v1.json');
writeFileSync(path, body, { mode: 0o600 });
process.stdout.write(JSON.stringify({ path, sha256: createHash('sha256').update(body).digest('hex'), summary }) + '\n');
