import { writeFileSync } from 'node:fs';
import { digest } from './research/verified-candles.js';
import { parseCbrKeyrateTable } from './research/sbgb-after-cbr-cut.js';

const url =
  'https://www.cbr.ru/hd_base/keyrate/?UniDbQuery.Posted=True&UniDbQuery.From=01.01.2015&UniDbQuery.To=31.12.2025';

async function main() {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(60_000),
    headers: { Accept: 'text/html', 'User-Agent': 'andstrel-trading-research' },
  });
  if (!response.ok) throw new Error(`CBR HTTP ${response.status}`);
  const body = await response.text();
  const rates = parseCbrKeyrateTable(body).filter((row) => row.day >= '2015-01-01' && row.day <= '2025-12-31');
  const snapshot = {
    source: url,
    fetchedAt: new Date().toISOString(),
    rows: rates.length,
    first: rates[0]?.day ?? null,
    last: rates.at(-1)?.day ?? null,
    rowsSha256: digest(JSON.stringify(rates)),
    rates,
  };
  writeFileSync('.trading/cbr-keyrate-2015-2025.json', JSON.stringify(snapshot), { mode: 0o600 });
  console.log(JSON.stringify({
    status: 'complete',
    rows: snapshot.rows,
    first: snapshot.first,
    last: snapshot.last,
    rowsSha256: snapshot.rowsSha256,
  }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
