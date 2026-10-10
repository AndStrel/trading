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

const ticker = 'FXGD';
const years = [2022, 2023, 2024, 2025];
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function page(board: string, year: number, start: number) {
  const endpoint = `https://iss.moex.com/iss/engines/stock/markets/shares/boards/${board}/securities/${ticker}/candles.json`;
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
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`MOEX ISS HTTP ${response.status}`);
  const payload = (await response.json()) as { candles?: { columns?: string[]; data?: unknown[][] } };
  const columns = payload.candles?.columns;
  const data = payload.candles?.data;
  if (!Array.isArray(columns) || !Array.isArray(data)) throw new Error('Invalid MOEX ISS candles block');
  return data;
}

function parse(year: number, values: unknown[]): Row {
  const [open, close, high, low, volume, begin, end] = values;
  if (typeof begin !== 'string' || typeof end !== 'string' || !begin.startsWith(String(year))) {
    throw new Error('Invalid daily timestamp');
  }
  if (typeof open !== 'number' || typeof close !== 'number' || typeof high !== 'number' ||
    typeof low !== 'number' || typeof volume !== 'number') {
    throw new Error('Invalid daily OHLCV types');
  }
  if (![open, close, high, low].every((v) => Number.isFinite(v) && v > 0) ||
    !Number.isSafeInteger(volume) || volume < 0) {
    throw new Error('Invalid daily OHLCV');
  }
  return { day: begin.slice(0, 10), begin, end, open, high, low, close, volume };
}

async function yearRows(board: string, year: number): Promise<Row[]> {
  const rows: Row[] = [];
  for (let start = 0, pages = 0; pages < 10; start += 500, pages++) {
    const data = await page(board, year, start);
    if (!data.length) break;
    rows.push(...data.map((values) => parse(year, values)));
  }
  rows.sort((a, b) => a.day.localeCompare(b.day));
  if (new Set(rows.map((row) => row.day)).size !== rows.length) throw new Error(`Duplicate date in ${year}`);
  return rows;
}

async function main() {
  const probeTqtf = await yearRows('TQTF', 2024);
  const board = probeTqtf.length >= 150 ? 'TQTF' : 'TQBR';
  const rows: Row[] = [];
  const coverage: { year: number; count: number; first: string | null; last: string | null; sha256: string }[] = [];
  for (const year of years) {
    const yearData = year === 2024 && board === 'TQTF' ? probeTqtf : await yearRows(board, year);
    if (year >= 2023 && (yearData.length < 150 || yearData.length > 400)) {
      throw new Error(`Unexpected FXGD ${board} coverage for ${year}: ${yearData.length}`);
    }
    coverage.push({
      year,
      count: yearData.length,
      first: yearData[0]?.day ?? null,
      last: yearData.at(-1)?.day ?? null,
      sha256: hash(yearData),
    });
    rows.push(...yearData);
    console.log(JSON.stringify({ board, ...coverage.at(-1) }));
  }
  const snapshot = {
    source: `MOEX ISS ${board} ${ticker} daily candles, interval=24`,
    board,
    fetchedAt: new Date().toISOString(),
    coverage,
    rowsSha256: hash(rows),
    rows,
  };
  writeFileSync('.trading/fxgd-daily-2022-2025.json', JSON.stringify(snapshot), { mode: 0o600 });
  console.log(JSON.stringify({ status: 'complete', ticker, board, rows: rows.length, rowsSha256: snapshot.rowsSha256 }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
