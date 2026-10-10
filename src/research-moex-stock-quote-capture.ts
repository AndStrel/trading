import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseDelayedStockQuote, type DelayedStockQuote } from './research/moex-delayed-stock-quote.js';

async function main(): Promise<void> {
  const ticker = process.env.QUOTE_TICKER;
  const count = Number(process.env.QUOTE_SAMPLES ?? '1');
  if (ticker !== 'TMON' && ticker !== 'TGLD' && ticker !== 'T') throw new Error('QUOTE_TICKER must be TMON, TGLD or T');
  if (!Number.isSafeInteger(count) || count < 1 || count > 480) throw new Error('QUOTE_SAMPLES must be an integer from 1 to 480');
  const directory = join('.trading', 'quotes');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = join(directory, `moex-delayed-${ticker}-attempts.jsonl`);
  const runId = randomUUID();
  let accepted = 0;
  for (let index = 0; index < count; index += 1) {
    const attemptedAtUtc = new Date().toISOString();
    const url = new URL(`https://iss.moex.com/iss/engines/stock/markets/shares/boards/TQBR/securities/${ticker}.json`);
    url.searchParams.set('iss.meta', 'off');
    url.searchParams.set('iss.only', 'marketdata');
    let status: 'accepted' | 'rejected' | 'http_error' | 'fetch_error' = 'fetch_error';
    let httpStatus: number | null = null;
    let payload: unknown = null;
    let sample: DelayedStockQuote | null = null;
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'AndStrel.trading-mcp' }, signal: AbortSignal.timeout(15_000) });
      httpStatus = response.status;
      if (response.ok) {
        payload = await response.json() as unknown;
        sample = parseDelayedStockQuote({ ticker: ticker as DelayedStockQuote['ticker'],
          observedAtUtc: new Date().toISOString(), payload });
        status = sample ? 'accepted' : 'rejected';
      } else status = 'http_error';
    } catch {
      status = 'fetch_error';
    }
    await appendFile(file, `${JSON.stringify({ runId, sampleNumber: index + 1, ticker, board: 'TQBR',
      attemptedAtUtc, recordedAtUtc: new Date().toISOString(), status, httpStatus, payload, sample })}\n`,
    { encoding: 'utf8', mode: 0o600 });
    if (sample) accepted += 1;
    if (index + 1 < count) await new Promise((resolve) => setTimeout(resolve, 60_000));
  }
  process.stdout.write(`Delayed stock quotes: ${accepted}/${count} accepted; all attempts: ${file}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'unknown error';
  process.stderr.write(`Delayed stock quote capture failed: ${message}\n`);
  process.exitCode = 1;
});
