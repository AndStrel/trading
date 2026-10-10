import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readWeekendSource } from './research-tmon-spbru-weekend-source.js';
import { weekdayDates } from './research-tmon-spbru-weekday-source.js';
import { weekendTickReturn as tickReturn } from './research/tmon-spbru-weekend.js';

const hash = (body: string | Buffer) => createHash('sha256').update(body).digest('hex');
const protocolSha256 = hash(readFileSync(join(process.cwd(), 'docs', 'TMON_SPBRU_WEEKDAY_INTRADAY_V1.md')));
if (protocolSha256 !== '2c62e2982ea35261a774d5da16d80ae29fc11ad5a57378de7d6a4591390360ef') {
  throw new Error('Frozen SPBRU weekday protocol changed');
}
const checkpointBody = readFileSync(join(process.cwd(), '.trading', 'tmon-spbru-weekday-source-checkpoint.json'));
const checkpointSha256 = hash(checkpointBody);
if (checkpointSha256 !== '859ae9d5a71fad79e9cd5eaeec3ebc45592b6896d647ec692d4bff543f1d87da') {
  throw new Error('Source-only SPBRU weekday checkpoint changed');
}
const checkpoint = JSON.parse(checkpointBody.toString('utf8')) as {
  priceOutcomesOpened: boolean; days: { date: string; cancelledEntry: boolean; unresolvedExit: boolean }[];
};
if (checkpoint.priceOutcomesOpened || checkpoint.days.some((day) => day.unresolvedExit)) {
  throw new Error('Unknown SPBRU weekday exits: refuse completed-only return score');
}
const { candlesByTime, sourceHashes } = readWeekendSource();
type Trade = { date: string; entry: number; exit: number; gross: number; baseNet: number;
  stressNet: number; worstIntradayBaseMark: number | null };
const expectedByDate = new Map(checkpoint.days.map((day) => [day.date, day]));
const decisions = weekdayDates().map((date) => {
  const expected = expectedByDate.get(date);
  if (!expected) throw new Error(`Missing source checkpoint date ${date}`);
  if (expected.cancelledEntry) return { date, status: 'cancelled_entry' as const };
  const entryCandle = candlesByTime.get(`${date}T08:00:00Z`);
  const exitCandle = candlesByTime.get(`${date}T14:00:00Z`);
  if (!entryCandle?.open?.value || !exitCandle?.open?.value) throw new Error(`Missing SPBRU weekday print ${date}`);
  const entry = Number(entryCandle.open.value);
  const exit = Number(exitCandle.open.value);
  const lows: number[] = [];
  for (let hour = 8; hour < 14; hour += 1) {
    const candle = candlesByTime.get(`${date}T${String(hour).padStart(2, '0')}:00:00Z`);
    if (!candle?.low?.value || candle.isComplete !== true || !(Number(candle.volume) > 0)) break;
    lows.push(Number(candle.low.value));
  }
  const trade: Trade = { date, entry, exit,
    gross: tickReturn(entry, exit, 0), baseNet: tickReturn(entry, exit, 1),
    stressNet: tickReturn(entry, exit, 2),
    worstIntradayBaseMark: lows.length === 6 ? tickReturn(entry, Math.min(...lows, exit), 1) : null };
  return { date, status: 'trade' as const, trade };
});
const trades = decisions.filter((decision): decision is { date: string; status: 'trade'; trade: Trade } => decision.status === 'trade');
if (trades.length !== 409) throw new Error('Completed-trade count differs from source checkpoint');

function summarize(rows: Trade[]) {
  const result = (key: 'gross' | 'baseNet' | 'stressNet') => {
    const values = rows.map((row) => row[key]);
    const winners = values.filter((value) => value > 0).length;
    return { winners, winRate: values.length ? winners / values.length : null,
      mean: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
      sum: values.reduce((sum, value) => sum + value, 0),
      withoutBestFiveSum: values.length > 5 ? [...values].sort((a, b) => b - a).slice(5)
        .reduce((sum, value) => sum + value, 0) : null,
      worst: values.length ? Math.min(...values) : null };
  };
  const marks = rows.flatMap((row) => row.worstIntradayBaseMark === null ? [] : [row.worstIntradayBaseMark]);
  return { trades: rows.length, gross: result('gross'), base: result('baseNet'), stress: result('stressNet'),
    intradayMarkCoverage: marks.length, worstIntradayBaseMark: marks.length ? Math.min(...marks) : null };
}
const year2025 = summarize(trades.filter((row) => row.date.startsWith('2025')).map((row) => row.trade));
const year2026 = summarize(trades.filter((row) => row.date.startsWith('2026')).map((row) => row.trade));
const combined = summarize(trades.map((row) => row.trade));
const numericalGatePass = year2025.trades >= 100 && year2026.trades >= 100 && combined.trades >= 250 &&
  year2025.base.winRate !== null && year2025.base.winRate >= 0.51 && year2025.base.mean !== null && year2025.base.mean > 0 &&
  year2026.base.winRate !== null && year2026.base.winRate >= 0.51 && year2026.base.mean !== null && year2026.base.mean > 0 &&
  combined.stress.mean !== null && combined.stress.mean > 0 &&
  combined.base.withoutBestFiveSum !== null && combined.base.withoutBestFiveSum > 0;
const report = { protocolSha256, checkpointSha256, sourceHashes, venue: 'TMON@/SPBRU',
  numericalGatePass, year2025, year2026, combined, decisions };
const body = `${JSON.stringify(report, null, 2)}\n`;
const outputPath = join(process.cwd(), '.trading', 'tmon-spbru-weekday-v1-results.json');
writeFileSync(outputPath, body, { mode: 0o600 });
process.stdout.write(`${JSON.stringify({ outputPath, sha256: hash(body), numericalGatePass,
  year2025, year2026, combined })}\n`);
