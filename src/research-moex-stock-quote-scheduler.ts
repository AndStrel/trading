import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { scheduledQuoteMinute } from './research/moex-stock-quote-schedule.js';

const execFileAsync = promisify(execFile);
let lastAttemptedMinute: string | null = null;

process.stdout.write('TMON read-only MOEX quote schedule active: weekdays 10:15–17:20 Europe/Moscow.\n');

while (true) {
  const minute = scheduledQuoteMinute(new Date());
  if (minute && minute !== lastAttemptedMinute) {
    lastAttemptedMinute = minute;
    try {
      const result = await execFileAsync(process.execPath, ['dist/research-moex-stock-quote-capture.js'], {
        env: { ...process.env, QUOTE_TICKER: 'TMON', QUOTE_SAMPLES: '1' },
        timeout: 25_000,
      });
      process.stdout.write(`${minute} ${result.stdout}`);
      if (result.stderr) process.stderr.write(result.stderr);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      process.stderr.write(`${minute} quote capture process failed: ${message}\n`);
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 5_000));
}
