import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

type Evidence = { ticker: string; day: string; from: string; to: string; times: string[]; incomplete: number; error?: string };
const db = new DatabaseSync('.trading/market-data.sqlite', { readOnly: true });
const records: { ticker: string; day: string; weekend: boolean; missing: string[]; reference: string;
  foundInReference: string[]; officialHaltDate: boolean; specialOpeningSchedule: boolean }[] = [];
const evidencePath = '.trading/gap-reference-times.json';
const evidence: Evidence[] = existsSync(evidencePath) ? JSON.parse(readFileSync(evidencePath, 'utf8')) as Evidence[] : [];
const officialHaltDates = new Set(['2024-02-13', '2024-02-14', '2024-08-14', '2024-11-07', '2025-09-13']);
try {
  db.exec('BEGIN');
  for (const ticker of ['SBER', 'GAZP']) {
    const rows = db.prepare(`SELECT c.candle_time time FROM historical_minute_candles c
      JOIN historical_archive_imports a ON a.instrument_id=c.instrument_id AND a.source_year=c.source_year
      WHERE a.ticker=? AND a.source_year IN (2023,2024,2025) ORDER BY c.candle_time`).all(ticker) as { time: string }[];
    if (!rows.length) throw new Error('Missing archive');
    const days = new Map<string, Set<number>>();
    for (const row of rows) {
      const time = Date.parse(row.time), day = new Date(time + 10800_000).toISOString().slice(0, 10);
      const timestamps = days.get(day) ?? new Set<number>(); timestamps.add(time); days.set(day, timestamps);
    }
    for (const [day, timestamps] of days) {
      const start = Date.parse(`${day}T10:00:00+03:00`), missing: string[] = [];
      for (let i = 0; i < 480; i++) if (!timestamps.has(start + i * 60_000)) missing.push(new Date(start + i * 60_000).toISOString());
      if (!missing.length) continue;
      const ref = evidence.find((r) => r.ticker === ticker && r.day === day);
      const valid = ref && !ref.error && ref.incomplete === 0 && Date.parse(ref.from) <= Date.parse(missing[0]!) &&
        Date.parse(ref.to) > Date.parse(missing.at(-1)!) && ref.times.length > 0;
      const referenceTimes = new Set(ref?.times.map((t) => new Date(t).toISOString()));
      const foundInReference = missing.filter((t) => referenceTimes.has(t));
      records.push({ ticker, day, weekend: [0, 6].includes(new Date(day).getUTCDay()), missing,
        reference: !valid ? 'unverified' : foundInReference.length ? 'source-disagreement' : 'absent-in-both-sources',
        foundInReference, officialHaltDate: officialHaltDates.has(day), specialOpeningSchedule: day === '2025-03-01' });
    }
  }
} finally { db.close(); }
const report = { scope: 'Observed dates only; 10:00–17:59 MSK; absence in two candle feeds is not proof of no trades.',
  evidenceSha256: existsSync(evidencePath) ? createHash('sha256').update(readFileSync(evidencePath)).digest('hex') : null,
  summary: { tickerDays: records.length, missingMinutes: records.reduce((s, r) => s + r.missing.length, 0),
    weekdayTickerDays: records.filter((r) => !r.weekend).length,
    officialHaltTickerDays: records.filter((r) => r.officialHaltDate).length,
    specialOpeningTickerDays: records.filter((r) => r.specialOpeningSchedule).length,
    unverified: records.filter((r) => r.reference === 'unverified').length,
    disagreement: records.filter((r) => r.reference === 'source-disagreement').length }, records };
writeFileSync('.trading/trading-gap-audit.json', JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify(report.summary));
