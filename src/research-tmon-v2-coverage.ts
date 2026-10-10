import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readCachedTmonDay, tmon2025Weekdays } from './research-tmon-2025-source.js';
import { readCachedTmon2026Day, tmon2026Weekdays } from './research-tmon-2026-source.js';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const source2025Sha256 = hash(readFileSync(join(process.cwd(), '.trading', 'tmon-2025-source.json')));
const source2026Sha256 = hash(readFileSync(join(process.cwd(), '.trading', 'tmon-2026-source.json')));
if (source2025Sha256 !== '05cfe825a69277c84b1243fb1c8084840853a174bf39b8a4efdaeb6b195a1b7f' ||
    source2026Sha256 !== '1af6cf14621282f93be857d1ab06df9e269b64f53bb842691d93e82a81ddd521') {
  throw new Error('TMON source manifest changed');
}

function coverage(dates: string[], readDay: (date: string) => { candles: { time: string }[] }) {
  const days = dates.map((date) => {
    const { candles } = readDay(date);
    const entryPrint = candles.some((candle) => candle.time.slice(11, 16) >= '10:01' && candle.time.slice(11, 16) <= '10:03');
    const exitPrint = candles.some((candle) => candle.time.slice(11, 16) >= '16:00' && candle.time.slice(11, 16) <= '17:00');
    return { date, active: candles.length > 0, entryPrint, exitPrint };
  });
  const active = days.filter((day) => day.active);
  return { summary: { weekdays: days.length, active: active.length,
    entered: active.filter((day) => day.entryPrint).length,
    cancelledEntries: active.filter((day) => !day.entryPrint).length,
    bothPrints: active.filter((day) => day.entryPrint && day.exitPrint).length,
    unresolvedEntered: active.filter((day) => day.entryPrint && !day.exitPrint).length }, days };
}

const report = { protocol: 'docs/TMON_INTRADAY_CARRY_V2.md', source2025Sha256, source2026Sha256,
  year2025: coverage(tmon2025Weekdays(), readCachedTmonDay),
  year2026: coverage(tmon2026Weekdays(), readCachedTmon2026Day) };
const body = `${JSON.stringify(report, null, 2)}\n`;
const path = join(process.cwd(), '.trading', 'tmon-v2-coverage.json');
writeFileSync(path, body, { mode: 0o600 });
process.stdout.write(JSON.stringify({ path, sha256: hash(body), year2025: report.year2025.summary,
  year2026: report.year2026.summary }) + '\n');
