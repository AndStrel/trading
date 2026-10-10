import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from './config.js';
import { parseQuoteSample } from './research/quote-capture.js';
import { TInvestClient } from './tbank/client.js';

async function main(): Promise<void> {
  const instrumentId = process.env.QUOTE_INSTRUMENT_ID;
  const count = Number(process.env.QUOTE_SAMPLES ?? '1');
  if (!instrumentId || !/^[A-Za-z0-9_-]{4,80}$/.test(instrumentId)) {
    throw new Error('Set QUOTE_INSTRUMENT_ID to a public FIGI or instrument UID');
  }
  if (!Number.isSafeInteger(count) || count < 1 || count > 480) {
    throw new Error('QUOTE_SAMPLES must be an integer from 1 to 480');
  }
  const config = loadConfig();
  if (!config.token) throw new Error('T_INVEST_TOKEN read-only token is required');
  const client = new TInvestClient(config.token, config.baseUrl, { transport: config.transport });
  const directory = join('.trading', 'quotes');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = join(directory, `${instrumentId}.jsonl`);
  let accepted = 0;
  for (let index = 0; index < count; index += 1) {
    const [payload, statusPayload] = await Promise.all([
      client.getOrderBook(instrumentId, 1),
      client.getTradingStatus(instrumentId),
    ]);
    const sample = parseQuoteSample({ instrumentId, observedAt: new Date().toISOString(), payload });
    const status = statusPayload as { tradingStatus?: unknown } | null;
    if (sample && status?.tradingStatus === 'SECURITY_TRADING_STATUS_NORMAL_TRADING') {
      await appendFile(file, `${JSON.stringify(sample)}\n`, { encoding: 'utf8', mode: 0o600 });
      accepted += 1;
    }
    if (index + 1 < count) await new Promise((resolve) => setTimeout(resolve, 60_000));
  }
  process.stdout.write(`Quote observations: ${accepted}/${count} accepted; local archive: ${file}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'unknown error';
  process.stderr.write(`Quote capture failed: ${message}\n`);
  process.exitCode = 1;
});
