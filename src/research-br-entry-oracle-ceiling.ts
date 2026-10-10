import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { br2026DaySpecs, readCachedBrDay } from './research-br-2026-source.js';
import { SI_BASE_COSTS, SI_STRESS_COSTS, siTradeReturn, validateSiDayCandles } from './research/si-first-hour.js';

const hash = (body: string | Buffer) => createHash('sha256').update(body).digest('hex');
const sourceReportSha256 = hash(readFileSync(join(process.cwd(), '.trading', 'br-2026-continuous-source.json')));
if (sourceReportSha256 !== 'd8721ce74334619fc1c7f6f960a85d6e77e7ddcb050958163a9b9d8081caf57a') {
  throw new Error('Locked BR source changed');
}
const specialDates = new Set(['2026-05-01', '2026-06-12']);
const specs = br2026DaySpecs().filter((spec) => !specialDates.has(spec.date));
const days = specs.map((spec) => {
  const candles = readCachedBrDay(spec).candles;
  validateSiDayCandles(candles, spec.date);
  const byMinute = new Map(candles.map((candle) => [candle.time.slice(11, 16), candle]));
  const entry = byMinute.get('11:01')?.open;
  if (entry === undefined) return { ...spec, status: 'missing' as const, reason: 'entry' };
  const future = [];
  for (let minute = 11 * 60 + 2; minute <= 16 * 60 + 55; minute += 1) {
    const hhmm = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
    const candle = byMinute.get(hhmm);
    if (!candle) return { ...spec, status: 'missing' as const, reason: 'holding_path' };
    future.push(candle);
  }
  const longExit = Math.max(...future.map((candle) => candle.high));
  const shortExit = Math.min(...future.map((candle) => candle.low));
  return { ...spec, status: 'complete' as const, entry,
    long: { exit: longExit, baseNet: siTradeReturn('long', entry, longExit, SI_BASE_COSTS),
      stressNet: siTradeReturn('long', entry, longExit, SI_STRESS_COSTS) },
    short: { exit: shortExit, baseNet: siTradeReturn('short', entry, shortExit, SI_BASE_COSTS),
      stressNet: siTradeReturn('short', entry, shortExit, SI_STRESS_COSTS) } };
});
const complete = days.filter((day): day is Extract<typeof days[number], { status: 'complete' }> => day.status === 'complete');
function summarize(side: 'long' | 'short') {
  const rows = complete.map((day) => day[side]);
  const baseWins = rows.filter((row) => row.baseNet > 0).length;
  const stressWins = rows.filter((row) => row.stressNet > 0).length;
  return { dates: days.length, missing: days.length - complete.length, complete: complete.length,
    baseWins, stressWins, baseWinRate: rows.length ? baseWins / rows.length : null,
    stressWinRate: rows.length ? stressWins / rows.length : null,
    meanOracleBase: rows.length ? rows.reduce((sum, row) => sum + row.baseNet, 0) / rows.length : null };
}
const report = { protocol: 'docs/BR_1101_ENTRY_ORACLE_CEILING_PROTOCOL.md',
  protocolSha256: hash(readFileSync(join(process.cwd(), 'docs', 'BR_1101_ENTRY_ORACLE_CEILING_PROTOCOL.md'))),
  sourceReportSha256, long: summarize('long'), short: summarize('short'), days };
const body = `${JSON.stringify(report, null, 2)}\n`;
const output = join(process.cwd(), '.trading', 'br-1101-entry-oracle-ceiling.json');
writeFileSync(output, body, { mode: 0o600 });
process.stdout.write(`${JSON.stringify({ output, sha256: hash(body), long: report.long, short: report.short })}\n`);
