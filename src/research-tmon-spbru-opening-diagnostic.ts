import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readWeekendSource } from './research-tmon-spbru-weekend-source.js';
import { weekendTickReturn as tickReturn } from './research/tmon-spbru-weekend.js';

// Exploratory 2025-only price-path description. Never treat a selected hour as an independent strategy.
const { candlesByTime, sourceHashes } = readWeekendSource();
const dates: string[] = [];
for (let ms = Date.parse('2025-03-01T00:00:00Z'); ms <= Date.parse('2025-12-31T00:00:00Z'); ms += 86_400_000) {
  const date = new Date(ms);
  if (date.getUTCDay() >= 1 && date.getUTCDay() <= 5) dates.push(date.toISOString().slice(0, 10));
}
const rows = Array.from({ length: 13 }, (_, index) => index + 8).map((exitHourUtc) => {
  const returns: { date: string; gross: number; base: number }[] = [];
  const missingDates: string[] = [];
  for (const date of dates) {
    const entry = candlesByTime.get(`${date}T07:00:00Z`);
    const exit = candlesByTime.get(`${date}T${String(exitHourUtc).padStart(2, '0')}:00:00Z`);
    if (!entry?.open?.value || !exit?.open?.value || entry.isComplete !== true || exit.isComplete !== true ||
        !(Number(entry.volume) > 0) || !(Number(exit.volume) > 0)) {
      missingDates.push(date);
      continue;
    }
    const buy = Number(entry.open.value);
    const sell = Number(exit.open.value);
    returns.push({ date, gross: tickReturn(buy, sell, 0), base: tickReturn(buy, sell, 1) });
  }
  const mean = (key: 'gross' | 'base') => returns.length ?
    returns.reduce((sum, row) => sum + row[key], 0) / returns.length : null;
  return { exitHourMsk: exitHourUtc + 3, completed: returns.length, missingDates,
    grossWinners: returns.filter((row) => row.gross > 0).length,
    baseWinners: returns.filter((row) => row.base > 0).length,
    meanGross: mean('gross'), meanBase: mean('base') };
});
const report = { scope: 'TMON@/SPBRU 2025 weekdays, 10:00 MSK hourly-open buy to every 11:00–23:00 hourly-open exit',
  exploratory: true, noIndependentHoldout: true, sourceHashes, dates: dates.length,
  cost: 'one adverse 0.01-RUB tick per side; preliminary zero brokerage', rows };
const body = `${JSON.stringify(report, null, 2)}\n`;
const outputPath = join(process.cwd(), '.trading', 'tmon-spbru-opening-diagnostic-2025.json');
writeFileSync(outputPath, body, { mode: 0o600 });
process.stdout.write(`${JSON.stringify({ outputPath,
  sha256: createHash('sha256').update(body).digest('hex'), dates: dates.length, rows })}\n`);
