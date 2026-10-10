import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

type Row = { day: string; begin: string; end: string; open: number; close: number;
  high: number; low: number; value: number; volume: number };
const requestedTicker = process.argv[2];
if (requestedTicker !== 'SBER' && requestedTicker !== 'SBERP' && requestedTicker !== 'GAZP' &&
  requestedTicker !== 'IMOEX') {
  throw new Error('Ticker must be SBER, SBERP, GAZP or IMOEX');
}
const ticker: 'SBER' | 'SBERP' | 'GAZP' | 'IMOEX' = requestedTicker;
const endpoint = ticker === 'IMOEX' ?
  'https://iss.moex.com/iss/engines/stock/markets/index/boards/SNDX/securities/IMOEX/candles.json' :
  `https://iss.moex.com/iss/engines/stock/markets/shares/securities/${ticker}/candles.json`;
const years = Array.from({ length: 8 }, (_, index) => 2007 + index);
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function page(year: number, start: number): Promise<unknown[][]> {
  const url = new URL(endpoint);
  for (const [key, value] of Object.entries({ interval: '24', from: `${year}-01-01`,
    till: `${year}-12-31`, start: String(start), 'iss.meta': 'off', 'iss.only': 'candles' })) {
    url.searchParams.set(key, value);
  }
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000),
        headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`MOEX ISS HTTP ${response.status}`);
      const payload = await response.json() as { candles?: { columns?: string[]; data?: unknown[][] } };
      const expected = ['open', 'close', 'high', 'low', 'value', 'volume', 'begin', 'end'];
      if (!Array.isArray(payload.candles?.columns) || !Array.isArray(payload.candles?.data) ||
        expected.some((column, index) => payload.candles!.columns![index]?.toLowerCase() !== column)) {
        throw new Error(`Unexpected ${ticker} historical schema`);
      }
      return payload.candles.data;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
  throw lastError;
}

function parse(year: number, values: unknown[]): Row {
  if (values.length !== 8) throw new Error(`Unexpected ${ticker} row width in ${year}`);
  const [open, close, high, low, value, volume, begin, end] = values;
  if (typeof begin !== 'string' || typeof end !== 'string' ||
    !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(begin) ||
    !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(end) ||
    !begin.startsWith(String(year)) || begin.slice(0, 10) !== end.slice(0, 10) || end < begin ||
    typeof open !== 'number' || typeof close !== 'number' || typeof high !== 'number' ||
    typeof low !== 'number' || typeof value !== 'number' || typeof volume !== 'number' ||
    ![open, close, high, low, value, volume].every(Number.isFinite) ||
    open <= 0 || close <= 0 || low <= 0 || high < Math.max(open, close, low) ||
    low > Math.min(open, close) || value < 0 || volume < 0) throw new Error(`Invalid ${ticker} daily candle`);
  return { day: begin.slice(0, 10), begin, end, open, close, high, low, value, volume };
}

async function main() {
  const rows: Row[] = [], coverage: { year: number; count: number; first: string | null;
    last: string | null; sha256: string }[] = [];
  for (const year of years) {
    const yearRows: Row[] = [];
    for (let start = 0, pages = 0; pages < 10; start += 500, pages++) {
      const data = await page(year, start);
      if (!data.length) break;
      yearRows.push(...data.map((values) => parse(year, values)));
      if (pages === 9) throw new Error(`Unexpectedly many ${ticker} pages in ${year}`);
    }
    const minimum = (ticker === 'SBER' || ticker === 'SBERP') && year === 2007 ? 100 : 150;
    if (yearRows.length < minimum || yearRows.length > 400) {
      throw new Error(`Unexpected ${ticker} ${year} coverage: ${yearRows.length}`);
    }
    yearRows.sort((a, b) => a.day.localeCompare(b.day));
    if (new Set(yearRows.map((row) => row.day)).size !== yearRows.length) {
      throw new Error(`Duplicate ${ticker} date in ${year}`);
    }
    coverage.push({ year, count: yearRows.length, first: yearRows[0]?.day ?? null,
      last: yearRows.at(-1)?.day ?? null, sha256: hash(yearRows) });
    rows.push(...yearRows);
    console.log(JSON.stringify(coverage.at(-1)));
  }
  const snapshot = { source: `MOEX ISS ${ticker} security-level daily candles, interval=24`,
    endpoint, fetchedAt: new Date().toISOString(), scope: '2007-2014 only; 2007 warmup',
    coverage, rowsSha256: hash(rows), rows };
  writeFileSync(`.trading/${ticker.toLowerCase()}-daily-2007-2014.json`,
    JSON.stringify(snapshot), { mode: 0o600 });
  console.log(JSON.stringify({ status: 'complete', ticker, rows: rows.length,
    rowsSha256: snapshot.rowsSha256 }));
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
