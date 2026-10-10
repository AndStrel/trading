import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readWeekendSource, weekendDates } from './research-tmon-spbru-weekend-source.js';
import { weekendTickReturn } from './research/tmon-spbru-weekend.js';

const hash = (body: string | Buffer) => createHash('sha256').update(body).digest('hex');
const protocolSha256 = hash(readFileSync(join(process.cwd(), 'docs', 'TMON_SPBRU_WEEKEND_INTRADAY_V1.md')));
if (protocolSha256 !== '81644ff577873af9ff2b9f48bff7905fba3f21a8835857d081fa6bec528eca0d') {
  throw new Error('Frozen SPBRU weekend protocol changed');
}
const checkpointBody = readFileSync(join(process.cwd(), '.trading', 'tmon-spbru-weekend-source-checkpoint.json'));
const checkpointSha256 = hash(checkpointBody);
if (checkpointSha256 !== 'd97df4975ad192a14ba5b2a75d4d8059c26b3b5962ab7617b1e6af072496483c') {
  throw new Error('Source-only SPBRU checkpoint changed');
}
const checkpoint = JSON.parse(checkpointBody.toString('utf8')) as {
  priceOutcomesOpened: boolean; days: { date: string; cancelledEntry: boolean; unresolvedExit: boolean }[];
};
if (checkpoint.priceOutcomesOpened || checkpoint.days.some((day) => day.unresolvedExit)) {
  throw new Error('Unknown SPBRU exits: refuse completed-only return score');
}
const { candlesByTime, sourceHashes } = readWeekendSource();
type Trade = { date: string; entry: number; exit: number; gross: number; baseNet: number;
  stressNet: number; worstIntradayBaseMark: number };
const decisions = weekendDates().map((date) => {
  const expected = checkpoint.days.find((day) => day.date === date);
  if (!expected) throw new Error(`Missing source checkpoint date ${date}`);
  const entryCandle = candlesByTime.get(`${date}T08:00:00Z`);
  const exitCandle = candlesByTime.get(`${date}T14:00:00Z`);
  if (expected.cancelledEntry) return { date, status: 'cancelled_entry' as const };
  if (!entryCandle?.open?.value || !exitCandle?.open?.value) throw new Error(`Missing SPBRU print ${date}`);
  const entry = Number(entryCandle.open.value);
  const exit = Number(exitCandle.open.value);
  const lows: number[] = [];
  for (let hour = 8; hour < 14; hour += 1) {
    const candle = candlesByTime.get(`${date}T${String(hour).padStart(2, '0')}:00:00Z`);
    if (!candle?.low?.value) throw new Error(`Missing holding-hour low ${date} ${hour}`);
    lows.push(Number(candle.low.value));
  }
  const trade: Trade = { date, entry, exit,
    gross: weekendTickReturn(entry, exit, 0),
    baseNet: weekendTickReturn(entry, exit, 1),
    stressNet: weekendTickReturn(entry, exit, 2),
    worstIntradayBaseMark: weekendTickReturn(entry, Math.min(...lows, exit), 1) };
  return { date, status: 'trade' as const, trade };
});
const trades = decisions.filter((decision): decision is { date: string; status: 'trade'; trade: Trade } => decision.status === 'trade');
if (trades.length !== 155) throw new Error('Completed-trade count differs from source checkpoint');

function summarize(rows: Trade[]) {
  const values = (key: 'gross' | 'baseNet' | 'stressNet') => rows.map((row) => row[key]);
  const result = (key: 'gross' | 'baseNet' | 'stressNet') => {
    const v = values(key);
    return { winners: v.filter((value) => value > 0).length,
      winRate: v.length ? v.filter((value) => value > 0).length / v.length : null,
      mean: v.length ? v.reduce((sum, value) => sum + value, 0) / v.length : null,
      sum: v.reduce((sum, value) => sum + value, 0),
      withoutBestFiveSum: v.length > 5 ? [...v].sort((a, b) => b - a).slice(5)
        .reduce((sum, value) => sum + value, 0) : null,
      worst: v.length ? Math.min(...v) : null };
  };
  return { trades: rows.length, gross: result('gross'), base: result('baseNet'), stress: result('stressNet'),
    worstIntradayBaseMark: rows.length ? Math.min(...rows.map((row) => row.worstIntradayBaseMark)) : null };
}
const year2025 = summarize(trades.filter((row) => row.date.startsWith('2025')).map((row) => row.trade));
const year2026 = summarize(trades.filter((row) => row.date.startsWith('2026')).map((row) => row.trade));
const combined = summarize(trades.map((row) => row.trade));
const numericalGatePass = year2025.trades >= 50 && year2026.trades >= 50 && combined.trades >= 100 &&
  year2025.base.winRate !== null && year2025.base.winRate >= 0.51 && year2025.base.mean !== null && year2025.base.mean > 0 &&
  year2026.base.winRate !== null && year2026.base.winRate >= 0.51 && year2026.base.mean !== null && year2026.base.mean > 0 &&
  combined.stress.mean !== null && combined.stress.mean > 0 &&
  combined.base.withoutBestFiveSum !== null && combined.base.withoutBestFiveSum > 0;
const report = { protocolSha256, checkpointSha256, sourceHashes, venue: 'TMON@/SPBRU',
  numericalGatePass, year2025, year2026, combined, decisions };
const body = `${JSON.stringify(report, null, 2)}\n`;
const outputPath = join(process.cwd(), '.trading', 'tmon-spbru-weekend-v1-results.json');
writeFileSync(outputPath, body, { mode: 0o600 });
process.stdout.write(`${JSON.stringify({ outputPath, sha256: hash(body), numericalGatePass,
  year2025, year2026, combined })}\n`);
