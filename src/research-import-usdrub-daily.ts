import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

type Row = {
  day: string;
  begin: string;
  end: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

const ticker = 'USD000UTSTOM';
const board = 'CETS';
const endpoint = `https://iss.moex.com/iss/engines/currency/markets/selt/boards/${board}/securities/${ticker}/candles.json`;
const years = [2021, 2022, 2023, 2024, 2025];
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function page(year: number, start: number) {
  const url = new URL(endpoint);
  for (const [key, value] of Object.entries({
    interval: '24',
    from: `${year}-01-01`,
    till: `${year}-12-31`,
    start: String(start),
    'iss.meta': 'off',
    'iss.only': 'candles',
    'candles.columns': 'open,close,high,low,volume,begin,end',
  })) url.searchParams.set(key, value);
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(30_000),
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`MOEX ISS HTTP ${response.status}`);
      const payload = (await response.json()) as { candles?: { columns?: string[]; data?: unknown[][] } };
      const columns = payload.candles?.columns;
      const data = payload.candles?.data;
      if (!Array.isArray(columns) || !Array.isArray(data)) throw new Error('Invalid MOEX ISS candles block');
      const expected = ['open', 'close', 'high', 'low', 'volume', 'begin', 'end'];
      if (expected.some((name, index) => columns[index]?.toLowerCase() !== name)) {
        throw new Error('Unexpected MOEX ISS columns');
      }
      return data;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
  throw lastError;
}

function parse(year: number, values: unknown[]): Row {
  if (values.length !== 7) throw new Error(`Unexpected daily row width for ${year}`);
  const [open, close, high, low, volume, begin, end] = values;
  if (
    typeof begin !== 'string' ||
    typeof end !== 'string' ||
    !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(begin) ||
    !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(end) ||
    end.slice(0, 10) !== begin.slice(0, 10) ||
    !begin.startsWith(String(year)) ||
    end < begin
  ) {
    throw new Error('Invalid daily timestamp');
  }
  if (
    ![open, close, high, low].every((v) => typeof v === 'number' && Number.isFinite(v) && v > 0) ||
    typeof open !== 'number' ||
    typeof close !== 'number' ||
    typeof high !== 'number' ||
    typeof low !== 'number' ||
    high < Math.max(open, close, low) ||
    low > Math.min(open, close) ||
    (volume !== null && (typeof volume !== 'number' || !Number.isFinite(volume) || volume < 0))
  ) {
    throw new Error('Invalid daily OHLCV');
  }
  const volumeValue = volume === null ? 0 : volume;
  return { day: begin.slice(0, 10), begin, end, open, high, low, close, volume: volumeValue };
}

async function main() {
  const rows: Row[] = [];
  const coverage: { year: number; count: number; first: string | null; last: string | null; sha256: string }[] = [];
  for (const year of years) {
    const yearRows: Row[] = [];
    for (let start = 0, pages = 0; pages < 10; start += 500, pages++) {
      const data = await page(year, start);
      if (!data.length) break;
      yearRows.push(...data.map((values) => parse(year, values)));
      if (pages === 9 && data.length === 500) throw new Error(`Unexpectedly many pages for ${year}`);
    }
    yearRows.sort((a, b) => a.day.localeCompare(b.day));
    if (new Set(yearRows.map((r) => r.day)).size !== yearRows.length) throw new Error(`Duplicate date in ${year}`);
    if (year >= 2023 && (yearRows.length < 150 || yearRows.length > 400)) {
      throw new Error(`Unexpected coverage for ${year}: ${yearRows.length}`);
    }
    coverage.push({
      year,
      count: yearRows.length,
      first: yearRows[0]?.day ?? null,
      last: yearRows.at(-1)?.day ?? null,
      sha256: hash(yearRows),
    });
    rows.push(...yearRows);
    console.log(JSON.stringify(coverage.at(-1)));
  }
  const snapshot = {
    source: `MOEX ISS ${board} ${ticker} daily candles, interval=24`,
    endpoint,
    fetchedAt: new Date().toISOString(),
    scope: '2021-2025; 2026 excluded',
    coverage,
    rowsSha256: hash(rows),
    rows,
  };
  writeFileSync('.trading/usdrub-tom-daily-2021-2025.json', JSON.stringify(snapshot), { mode: 0o600 });
  console.log(JSON.stringify({ status: 'complete', ticker, rows: rows.length, rowsSha256: snapshot.rowsSha256 }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
