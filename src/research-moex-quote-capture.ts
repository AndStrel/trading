import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseDelayedMoexQuote } from './research/moex-delayed-quote.js';

async function main(): Promise<void> {
  const instrumentId = process.env.QUOTE_INSTRUMENT_ID;
  const count = Number(process.env.QUOTE_SAMPLES ?? '1');
  if (!instrumentId || !/^[A-Za-z0-9-]{3,32}$/.test(instrumentId)) {
    throw new Error('Set QUOTE_INSTRUMENT_ID to a public MOEX futures code');
  }
  if (!Number.isSafeInteger(count) || count < 1 || count > 480) {
    throw new Error('QUOTE_SAMPLES must be an integer from 1 to 480');
  }
  const directory = join('.trading', 'quotes');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = join(directory, `moex-${instrumentId}.jsonl`);
  let accepted = 0;
  for (let index = 0; index < count; index += 1) {
    const url = new URL(`https://iss.moex.com/iss/engines/futures/markets/forts/securities/${instrumentId}.json`);
    url.searchParams.set('iss.meta', 'off');
    url.searchParams.set('iss.only', 'marketdata');
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`MOEX ISS returned HTTP ${response.status}`);
    const sample = parseDelayedMoexQuote({
      instrumentId,
      observedAt: new Date().toISOString(),
      payload: await response.json() as unknown,
    });
    if (sample) {
      await appendFile(file, `${JSON.stringify(sample)}\n`, { encoding: 'utf8', mode: 0o600 });
      accepted += 1;
    }
    if (index + 1 < count) await new Promise((resolve) => setTimeout(resolve, 60_000));
  }
  process.stdout.write(`Delayed MOEX observations: ${accepted}/${count} accepted; local archive: ${file}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'unknown error';
  process.stderr.write(`Delayed quote capture failed: ${message}\n`);
  process.exitCode = 1;
});
