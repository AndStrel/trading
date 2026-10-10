import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { oracleLongNetFromDailyRange } from './research/lqdt-fee-ceiling.js';

type Page = { start: number; body: string; sha256: string };
const sourcePath = join(process.cwd(), '.trading', 'lqdt-2025-daily-source.json');
const reportPath = join(process.cwd(), '.trading', 'lqdt-2025-fee-ceiling.json');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const fee = 0.003;

function parsePage(body: string): { columns: string[]; data: unknown[][] } {
  const payload = JSON.parse(body) as unknown;
  if (!payload || typeof payload !== 'object' || !('candles' in payload)) throw new Error('Missing candles block');
  const block = payload.candles;
  if (!block || typeof block !== 'object' || !('columns' in block) || !('data' in block) ||
      !Array.isArray(block.columns) || !Array.isArray(block.data) ||
      !block.columns.every((name) => typeof name === 'string') ||
      !block.data.every((row) => Array.isArray(row))) throw new Error('Invalid candles block');
  return { columns: block.columns as string[], data: block.data as unknown[][] };
}

async function fetchPages(): Promise<Page[]> {
  const pages: Page[] = [];
  for (let start = 0; start <= 500; start += 100) {
    const url = new URL('https://iss.moex.com/iss/engines/stock/markets/shares/boards/TQTF/securities/LQDT/candles.json');
    for (const [key, value] of Object.entries({ interval: '24', from: '2025-01-01', till: '2025-12-31',
      start: String(start), 'iss.meta': 'off', 'iss.only': 'candles', 'candles.columns': 'open,close,high,low,volume,begin' })) {
      url.searchParams.set(key, value);
    }
    let body: string | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'AndStrel.trading-mcp' },
          signal: AbortSignal.timeout(30_000) });
        if (!response.ok) throw new Error(`MOEX HTTP ${response.status}`);
        body = await response.text();
        parsePage(body);
        break;
      } catch (error) {
        if (attempt === 2) throw error;
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
      }
    }
    if (body === undefined) throw new Error('MOEX response unavailable');
    pages.push({ start, body, sha256: hash(body) });
    if (parsePage(body).data.length < 100) break;
  }
  return pages;
}

async function main(): Promise<void> {
  let pages: Page[];
  if (existsSync(sourcePath)) {
    const cached = JSON.parse(readFileSync(sourcePath, 'utf8')) as { pages?: Page[] };
    if (!Array.isArray(cached.pages)) throw new Error('Invalid local source');
    pages = cached.pages;
  } else {
    pages = await fetchPages();
    writeFileSync(sourcePath, `${JSON.stringify({ source: 'MOEX ISS LQDT TQTF daily candles 2025', pages })}\n`,
      { mode: 0o600, flag: 'wx' });
  }
  const seen = new Map<string, string>();
  const days: { date: string; oracleNet: number; positive: boolean }[] = [];
  let weekends = 0;
  let invalid = 0;
  let repeatedIdenticalRows = 0;
  for (const page of pages) {
    if (page.sha256 !== hash(page.body)) throw new Error('Changed MOEX source page');
    const { columns, data } = parsePage(page.body);
    const index = (name: string) => { const value = columns.indexOf(name); if (value < 0) throw new Error(`Missing ${name}`); return value; };
    const beginIndex = index('begin');
    const highIndex = index('high');
    const lowIndex = index('low');
    for (const row of data) {
      const begin = row[beginIndex];
      if (typeof begin !== 'string' || !/^2025-\d{2}-\d{2} /.test(begin)) throw new Error('Invalid candle date');
      const date = begin.slice(0, 10);
      const serialized = JSON.stringify(row);
      const previous = seen.get(date);
      if (previous !== undefined) {
        if (previous !== serialized) throw new Error(`Conflicting duplicate date ${date}`);
        repeatedIdenticalRows += 1;
        continue;
      }
      seen.set(date, serialized);
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
      if (weekday === 0 || weekday === 6) { weekends += 1; continue; }
      const high = row[highIndex];
      const low = row[lowIndex];
      if (typeof high !== 'number' || typeof low !== 'number' || !Number.isFinite(high) ||
          !Number.isFinite(low) || low <= 0 || high < low) { invalid += 1; continue; }
      const oracleNet = oracleLongNetFromDailyRange(low, high, fee);
      days.push({ date, oracleNet, positive: oracleNet > 0 });
    }
  }
  const positiveOracleDays = days.filter((day) => day.positive).length;
  const summary = { validWeekdays: days.length, positiveOracleDays, positiveFraction: days.length ? positiveOracleDays / days.length : 0,
    invalid, weekends, repeatedIdenticalRows, has100PossibleWinners: positiveOracleDays >= 100,
    unconditional51PercentPossible: days.length > 0 && positiveOracleDays >= Math.ceil(days.length * 0.51) };
  const sourceSha256 = hash(readFileSync(sourcePath, 'utf8'));
  const report = { protocol: 'docs/LQDT_INTRADAY_FEE_CEILING_PROTOCOL.md', sourceSha256, summary, days };
  const reportBody = `${JSON.stringify(report, null, 2)}\n`;
  writeFileSync(reportPath, reportBody, { mode: 0o600 });
  process.stdout.write(JSON.stringify({ sourcePath, sourceSha256, reportPath, reportSha256: hash(reportBody), summary }) + '\n');
}

main().catch((error: unknown) => {
  process.stderr.write(`LQDT fee ceiling failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
  process.exitCode = 1;
});
