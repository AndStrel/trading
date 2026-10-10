import { parseDelayedStockQuote, type DelayedStockQuote } from './moex-delayed-stock-quote.js';

type Attempt = { ticker: string; board: string; attemptedAtUtc: string; status: string;
  payload: unknown; sample: unknown };

const moscowClock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Moscow',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

function moscowParts(utc: string): Record<string, string> {
  return Object.fromEntries(moscowClock.formatToParts(new Date(utc)).map((part) => [part.type, part.value]));
}

function percentile(values: readonly number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(fraction * sorted.length) - 1] ?? null;
}

function quoteAgeAtSourceMinutes(quote: DelayedStockQuote): number | null {
  const sourceDate = quote.sourceSystemTimeMsk.slice(0, 10);
  const systemMs = Date.parse(`${quote.sourceSystemTimeMsk.replace(' ', 'T')}+03:00`);
  const updateMs = Date.parse(`${sourceDate}T${quote.sourceUpdateTimeMsk}+03:00`);
  const age = (systemMs - updateMs) / 60_000;
  // UPDATETIME has no date: a negative delta could be a previous-day update.
  return Number.isFinite(age) && age >= 0 ? age : null;
}

export function analyzeTmonQuoteAttempts(lines: readonly string[]) {
  let rejected = 0;
  let httpErrors = 0;
  let fetchErrors = 0;
  const accepted: { date: string; minute: string; quote: DelayedStockQuote }[] = [];
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    let attempt: Attempt;
    try { attempt = JSON.parse(line) as Attempt; }
    catch { throw new Error(`Invalid quote JSONL line ${index + 1}`); }
    if (attempt.ticker !== 'TMON' || attempt.board !== 'TQBR' || !Number.isFinite(Date.parse(attempt.attemptedAtUtc))) {
      throw new Error(`Invalid quote attempt line ${index + 1}`);
    }
    if (attempt.status === 'rejected') { rejected += 1; continue; }
    if (attempt.status === 'http_error') { httpErrors += 1; continue; }
    if (attempt.status === 'fetch_error') { fetchErrors += 1; continue; }
    if (attempt.status !== 'accepted') throw new Error(`Unknown quote attempt status on line ${index + 1}`);
    const sample = attempt.sample as DelayedStockQuote;
    const parsed = parseDelayedStockQuote({ ticker: 'TMON', observedAtUtc: sample?.observedAtUtc, payload: attempt.payload });
    if (!parsed || JSON.stringify(parsed) !== JSON.stringify(sample)) throw new Error(`Accepted quote mismatch on line ${index + 1}`);
    const parts = moscowParts(attempt.attemptedAtUtc);
    accepted.push({ date: `${parts.year}-${parts.month}-${parts.day}`,
      minute: `${parts.hour}:${parts.minute}`, quote: parsed });
  }
  const unique = new Map<string, typeof accepted[number]>();
  for (const row of accepted) {
    const quote = row.quote;
    // SYSTIME may advance even when the top of book has not been updated.
    unique.set(`${row.date}|${quote.sourceUpdateTimeMsk}|${quote.bid}|${quote.ask}|${quote.bidDepth}|${quote.askDepth}`, row);
  }
  const rows = [...unique.values()];
  const spread = rows.map((row) => row.quote.spreadBps);
  const ages = rows.map((row) => quoteAgeAtSourceMinutes(row.quote));
  const knownAges = ages.filter((age): age is number => age !== null);
  const byDate = Object.fromEntries([...new Set(rows.map((row) => row.date))].sort().map((date) => [date, {
    uniqueQuotes: rows.filter((row) => row.date === date).length,
    openingWindowQuotes: rows.filter((row) => row.date === date && row.minute >= '10:15' && row.minute <= '10:30').length,
    closingWindowQuotes: rows.filter((row) => row.date === date && row.minute >= '16:15' && row.minute <= '17:20').length,
  }]));
  return { attempts: accepted.length + rejected + httpErrors + fetchErrors,
    acceptedAttempts: accepted.length, rejected, httpErrors, fetchErrors,
    uniqueQuotes: rows.length, duplicates: accepted.length - rows.length,
    spreadBps: { median: percentile(spread, 0.5), p90: percentile(spread, 0.9), max: spread.length ? Math.max(...spread) : null },
    quoteAgeAtSourceMinutes: { median: percentile(knownAges, 0.5), p90: percentile(knownAges, 0.9),
      max: knownAges.length ? Math.max(...knownAges) : null, unknown: ages.length - knownAges.length },
    byDate };
}
