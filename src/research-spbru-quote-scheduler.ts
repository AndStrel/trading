import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseSpbruUnaryBook } from './research/spbru-unary-book.js';
import { scheduledSpbruQuoteMinute } from './research/spbru-quote-schedule.js';
import { TInvestClient } from './tbank/client.js';

const instrumentId = '498ec3ff-ef27-4729-9703-a5aac48d5789'; // TMON@/SPBRU, not TMON/TQBR.
const secretPath = '/run/secrets/tinvest_readonly_token';
const outputDir = join(process.cwd(), '.trading', 'quotes-spbru');
const outputFile = join(outputDir, 'tmon-spbru-attempts.jsonl');
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  // Compose mounts only this dedicated read-only secret, never the project's .env.
  const token = (await readFile(secretPath, 'utf8')).trim();
  if (!token || /\s/.test(token)) throw new Error('A dedicated single-line read-only token is required');
  const client = new TInvestClient(token, 'https://invest-public-api.tbank.ru/rest',
    { transport: 'system-curl', retryAttempts: 2, requestTimeoutMs: 25_000 });
  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  process.stdout.write('TMON@/SPBRU read-only orderbook schedule active: every 5 minutes, 10:05–22:55 MSK.\n');
  let lastAttemptedMinute: string | null = null;
  while (true) {
    const slot = scheduledSpbruQuoteMinute(new Date());
    if (slot && slot !== lastAttemptedMinute) {
      lastAttemptedMinute = slot;
      const startedAtUtc = new Date().toISOString();
      let row: Record<string, unknown>;
      try {
        const [book, status] = await Promise.all([
          client.getOrderBook(instrumentId, 5), client.getTradingStatus(instrumentId),
        ]);
        const observedAtUtc = new Date().toISOString();
        const tradingStatus = (status as { tradingStatus?: unknown } | null)?.tradingStatus;
        const sample = parseSpbruUnaryBook({ observedAtUtc, payload: book, maxAgeMs: 15_000 });
        row = tradingStatus === 'SECURITY_TRADING_STATUS_NORMAL_TRADING' && sample
          ? { slot, startedAtUtc, observedAtUtc, result: 'accepted', sample }
          : { slot, startedAtUtc, observedAtUtc, result: 'rejected',
            reason: tradingStatus !== 'SECURITY_TRADING_STATUS_NORMAL_TRADING' ? 'not_normal_trading' : 'invalid_or_stale_book' };
      } catch {
        // Never serialize API errors: a remote message might contain sensitive context.
        row = { slot, startedAtUtc, observedAtUtc: new Date().toISOString(), result: 'request_error' };
      }
      await appendFile(outputFile, `${JSON.stringify(row)}\n`, { encoding: 'utf8', mode: 0o600 });
      process.stdout.write(`${slot} ${row.result}\n`);
    }
    await sleep(5_000);
  }
}

main().catch(() => {
  process.stderr.write('TMON@/SPBRU read-only quote collector failed to initialize or write an observation.\n');
  process.exitCode = 1;
});
