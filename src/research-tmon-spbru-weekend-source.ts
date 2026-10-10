import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Candle = { time: string; volume?: string; isComplete?: boolean; candleSource?: string;
  open?: { value?: string }; high?: { value?: string }; low?: { value?: string }; close?: { value?: string } };
type Page = { instrumentId: string; from: string; to: string; interval: string; candleSourceType: string;
  candles: Candle[] };
const archive = [
  ['2025-03-01_2025-05-31', '2e5babfa13b4d2a033ed74e2e38b8065f4f3066e47d71e003b6fe31e8e65c3cd'],
  ['2025-06-01_2025-08-31', '5336c8ee212d25f63acdef002ec58566f9d820c8a8ed129d769ecd5d593f524d'],
  ['2025-09-01_2025-11-30', '54b988ff807e9163cdb5858e6447636e1ee89871550e604b29a4bfedca3b771a'],
  ['2025-12-01_2026-02-28', '98c61c2916f0dc5dc20d2ebe2496d2d0c0010291a6fee2d487f1d9d7898909ea'],
  ['2026-03-01_2026-05-31', 'a73335fdc87c6fb6783ccfa01f296a14da9afb5112f399752ff4fbadcb5a8b6d'],
  ['2026-06-01_2026-08-31', 'bf18db14367836ccf50f8204db1a6fdbf43caa52d5673fff097039e71065a2f7'],
  ['2026-09-01_2026-09-27', '9786fa89fe265aebdf84596431d7ee13662c6405047dcc056e7d3f4071fe4959'],
] as const;
const hash = (body: string | Buffer) => createHash('sha256').update(body).digest('hex');

export function weekendDates(): string[] {
  const dates: string[] = [];
  for (let ms = Date.parse('2025-03-01T00:00:00Z'); ms <= Date.parse('2026-09-27T00:00:00Z'); ms += 86_400_000) {
    const day = new Date(ms).getUTCDay();
    if (day === 0 || day === 6) dates.push(new Date(ms).toISOString().slice(0, 10));
  }
  return dates;
}

export function readWeekendSource(): { candlesByTime: Map<string, Candle>; sourceHashes: { file: string; sha256: string }[];
  totalCandles: number; zeroVolumeCandles: number; incompleteCandles: number } {
  const candlesByTime = new Map<string, Candle>();
  const sourceHashes: { file: string; sha256: string }[] = [];
  let totalCandles = 0;
  let zeroVolumeCandles = 0;
  let incompleteCandles = 0;
  for (const [label, expectedSha256] of archive) {
    const file = `tmon-spbru-hour-${label}.json`;
    const body = readFileSync(join(process.cwd(), '.trading', file));
    const sha256 = hash(body);
    if (sha256 !== expectedSha256) throw new Error(`Changed source ${file}`);
    const page = JSON.parse(body.toString('utf8')) as Page;
    if (page.instrumentId !== '498ec3ff-ef27-4729-9703-a5aac48d5789' ||
        page.interval !== 'CANDLE_INTERVAL_HOUR' || page.candleSourceType !== 'CANDLE_SOURCE_EXCHANGE' ||
        !Array.isArray(page.candles)) throw new Error(`Invalid source metadata ${file}`);
    for (const candle of page.candles) {
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$/.test(candle.time) ||
          candle.time < page.from || candle.time >= page.to || candle.candleSource !== 'CANDLE_SOURCE_EXCHANGE' ||
          candlesByTime.has(candle.time)) throw new Error(`Invalid or duplicated candle time ${file}`);
      candlesByTime.set(candle.time, candle);
      totalCandles += 1;
      if (!(Number(candle.volume) > 0)) zeroVolumeCandles += 1;
      if (candle.isComplete !== true) incompleteCandles += 1;
    }
    sourceHashes.push({ file, sha256 });
  }
  return { candlesByTime, sourceHashes, totalCandles, zeroVolumeCandles, incompleteCandles };
}

function main(): void {
  const { candlesByTime, sourceHashes, totalCandles, zeroVolumeCandles, incompleteCandles } = readWeekendSource();
  const days = weekendDates().map((date) => {
    const entry = candlesByTime.get(`${date}T08:00:00Z`);
    const exit = candlesByTime.get(`${date}T14:00:00Z`);
    const entryValid = !!entry && entry.isComplete === true && Number(entry.volume) > 0;
    const exitValid = !!exit && exit.isComplete === true && Number(exit.volume) > 0;
    return { date, entryPresent: !!entry, exitPresent: !!exit,
      entryPositiveComplete: entryValid, exitPositiveComplete: exitValid,
      cancelledEntry: !entryValid, unresolvedExit: entryValid && !exitValid };
  });
  const byYear = Object.fromEntries(['2025', '2026'].map((year) => {
    const rows = days.filter((day) => day.date.startsWith(year));
    return [year, { weekendDates: rows.length, completedPairs: rows.filter((day) => day.entryPositiveComplete && day.exitPositiveComplete).length,
      cancelledEntries: rows.filter((day) => day.cancelledEntry).length,
      unresolvedExits: rows.filter((day) => day.unresolvedExit).length }];
  }));
  const report = { protocolSha256: hash(readFileSync(join(process.cwd(), 'docs', 'TMON_SPBRU_WEEKEND_INTRADAY_V1.md'))),
    sourceHashes, totalCandles, zeroVolumeCandles, incompleteCandles, priceOutcomesOpened: false, byYear, days };
  const body = `${JSON.stringify(report, null, 2)}\n`;
  const outputPath = join(process.cwd(), '.trading', 'tmon-spbru-weekend-source-checkpoint.json');
  writeFileSync(outputPath, body, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ outputPath, sha256: hash(body), totalCandles,
    zeroVolumeCandles, incompleteCandles, byYear })}\n`);
}

if (process.argv[1]?.endsWith('/research-tmon-spbru-weekend-source.js')) main();
