import type { SpbruBookSample } from './spbru-unary-book.js';
import { scheduledSpbruQuoteMinute } from './spbru-quote-schedule.js';

const expectedUid = '498ec3ff-ef27-4729-9703-a5aac48d5789';
type Attempt = { slot: string; startedAtUtc: string; observedAtUtc: string;
  result: 'accepted' | 'rejected' | 'request_error'; reason?: string; sample?: SpbruBookSample };

function percentile(values: readonly number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(fraction * sorted.length) - 1] ?? null;
}

function validAttempt(value: unknown): value is Attempt {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  if (typeof row.slot !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}\+03:00$/.test(row.slot) ||
      !Number.isFinite(Date.parse(row.slot)) || scheduledSpbruQuoteMinute(new Date(row.slot)) !== row.slot ||
      typeof row.startedAtUtc !== 'string' ||
      typeof row.observedAtUtc !== 'string') return false;
  const started = Date.parse(row.startedAtUtc);
  const observed = Date.parse(row.observedAtUtc);
  const slotStart = Date.parse(row.slot);
  if (!Number.isFinite(started) || !Number.isFinite(observed) ||
      started < slotStart || started >= slotStart + 60_000 || observed < started ||
      !['accepted', 'rejected', 'request_error'].includes(String(row.result))) return false;
  if (row.result !== 'accepted') return row.sample === undefined;
  if (typeof row.sample !== 'object' || row.sample === null) return false;
  const sample = row.sample as Record<string, unknown>;
  const bid = Number(sample.bid);
  const ask = Number(sample.ask);
  const ageMs = Number(sample.ageMs);
  const spreadBps = Number(sample.spreadBps);
  const bookAt = typeof sample.bookAtUtc === 'string' ? Date.parse(sample.bookAtUtc) : NaN;
  return sample.instrumentId === expectedUid && sample.observedAtUtc === row.observedAtUtc &&
    Number.isFinite(bookAt) && Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask > bid &&
    Number.isSafeInteger(sample.bidQuantity) && Number(sample.bidQuantity) > 0 &&
    Number.isSafeInteger(sample.askQuantity) && Number(sample.askQuantity) > 0 &&
    Number.isFinite(ageMs) && ageMs >= -1_000 && ageMs <= 15_000 &&
    Math.abs(ageMs - (observed - bookAt)) <= 2 &&
    Number.isFinite(spreadBps) && Math.abs(spreadBps - 10_000 * (ask - bid) / ((ask + bid) / 2)) < 1e-6;
}

export function analyzeSpbruQuoteAttempts(lines: readonly string[]) {
  const attempts: Attempt[] = [];
  const seenSlots = new Set<string>();
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(line) as unknown; }
    catch { throw new Error(`Invalid SPBRU quote JSONL line ${index + 1}`); }
    if (!validAttempt(parsed)) throw new Error(`Invalid SPBRU quote attempt line ${index + 1}`);
    if (seenSlots.has(parsed.slot)) throw new Error(`Duplicate SPBRU quote slot on line ${index + 1}`);
    seenSlots.add(parsed.slot);
    attempts.push(parsed);
  }
  const accepted = attempts.filter((row): row is Attempt & { sample: SpbruBookSample } => row.result === 'accepted');
  const uniqueBooks = new Map<string, typeof accepted[number]>();
  for (const row of accepted) {
    const sample = row.sample;
    uniqueBooks.set([sample.bookAtUtc, sample.bid, sample.ask, sample.bidQuantity, sample.askQuantity].join('|'), row);
  }
  const unique = [...uniqueBooks.values()];
  const distinctTopLevels = new Set(accepted.map((row) => {
    const sample = row.sample;
    return [sample.bid, sample.ask, sample.bidQuantity, sample.askQuantity].join('|');
  }));
  const spreads = unique.map((row) => row.sample.spreadBps);
  const ages = unique.map((row) => row.sample.ageMs);
  const dates = [...new Set(attempts.map((row) => row.slot.slice(0, 10)))].sort();
  const byDate = Object.fromEntries(dates.map((date) => [date, {
    attempts: attempts.filter((row) => row.slot.startsWith(date)).length,
    accepted: accepted.filter((row) => row.slot.startsWith(date)).length,
    uniqueBooks: unique.filter((row) => row.slot.startsWith(date)).length,
  }]));
  return { attempts: attempts.length, accepted: accepted.length,
    rejected: attempts.filter((row) => row.result === 'rejected').length,
    requestErrors: attempts.filter((row) => row.result === 'request_error').length,
    uniqueBooks: unique.length, repeatedBooks: accepted.length - unique.length,
    distinctTopLevels: distinctTopLevels.size,
    repeatedTopLevels: accepted.length - distinctTopLevels.size,
    spreadBps: { median: percentile(spreads, 0.5), p90: percentile(spreads, 0.9),
      max: spreads.length ? Math.max(...spreads) : null },
    bookAgeMs: { median: percentile(ages, 0.5), p90: percentile(ages, 0.9),
      max: ages.length ? Math.max(...ages) : null }, byDate };
}
