import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readWeekendSource } from './research-tmon-spbru-weekend-source.js';

const hash = (body: string | Buffer) => createHash('sha256').update(body).digest('hex');
const frozenProtocolSha256 = '2c62e2982ea35261a774d5da16d80ae29fc11ad5a57378de7d6a4591390360ef';

export function weekdayDates(): string[] {
  const dates: string[] = [];
  for (let ms = Date.parse('2025-03-01T00:00:00Z'); ms <= Date.parse('2026-09-27T00:00:00Z'); ms += 86_400_000) {
    const day = new Date(ms).getUTCDay();
    if (day >= 1 && day <= 5) dates.push(new Date(ms).toISOString().slice(0, 10));
  }
  return dates;
}

function main(): void {
  const protocolSha256 = hash(readFileSync(join(process.cwd(), 'docs', 'TMON_SPBRU_WEEKDAY_INTRADAY_V1.md')));
  if (protocolSha256 !== frozenProtocolSha256) throw new Error('Frozen weekday protocol changed');
  const { candlesByTime, sourceHashes, totalCandles, zeroVolumeCandles, incompleteCandles } = readWeekendSource();
  const days = weekdayDates().map((date) => {
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
    return [year, { weekdayDates: rows.length,
      completedPairs: rows.filter((day) => day.entryPositiveComplete && day.exitPositiveComplete).length,
      cancelledEntries: rows.filter((day) => day.cancelledEntry).length,
      unresolvedExits: rows.filter((day) => day.unresolvedExit).length }];
  }));
  const report = { protocolSha256, sourceHashes, totalCandles, zeroVolumeCandles, incompleteCandles,
    priceOutcomesOpened: false, byYear, days };
  const body = `${JSON.stringify(report, null, 2)}\n`;
  const outputPath = join(process.cwd(), '.trading', 'tmon-spbru-weekday-source-checkpoint.json');
  writeFileSync(outputPath, body, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ outputPath, sha256: hash(body), totalCandles,
    zeroVolumeCandles, incompleteCandles, byYear })}\n`);
}

if (process.argv[1]?.endsWith('/research-tmon-spbru-weekday-source.js')) main();
