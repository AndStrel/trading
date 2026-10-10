import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readCachedT2024Day, t2024DaySpecs } from './research-t-2024-source.js';
import { readCachedTDay, t2025Weekdays } from './research-t-2025-source.js';
import { evaluateTCeilingDay, summarizeTCeilingDays } from './research/t-intraday-cost-ceiling.js';

const hash = (body: string) => createHash('sha256').update(body).digest('hex');
const days2024 = t2024DaySpecs().map((spec) => evaluateTCeilingDay({ ...spec,
  candles: readCachedT2024Day(spec).candles }));
const days2025 = t2025Weekdays().map((date) => evaluateTCeilingDay({ date, ticker: 'T',
  candles: readCachedTDay(date).candles }));
const report = { purpose: 'Exploratory cost ceiling, NOT a trading strategy: oracle uses future high and unrealizable best-price exit',
  window: 'Enter 10:31 minute open; scheduled exit 16:55 minute open; oracle chooses best later high from 10:32–16:54',
  costs: 'Adverse execution 0.05% per side; Investor commission 0.30% per side; conditional Pro brokerage fee zero; adverse tick rounding',
  byYear: { 2024: { summary: summarizeTCeilingDays(days2024), days: days2024 },
    2025: { summary: summarizeTCeilingDays(days2025), days: days2025 } } };
const body = `${JSON.stringify(report, null, 2)}\n`;
const outputPath = join(process.cwd(), '.trading', 't-intraday-cost-ceiling-2024-2025.json');
writeFileSync(outputPath, body, { mode: 0o600 });
console.log(JSON.stringify({ outputPath, sha256: hash(body), summaries: {
  2024: report.byYear[2024].summary, 2025: report.byYear[2025].summary } }));
