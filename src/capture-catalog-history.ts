import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { captureFrozenMoexMinuteSource, FrozenMoexCaptureError } from './history/frozen-moex-minute-capture.js';

export type FrozenCaptureCliOptions = { outputDirectory: string | null; help: boolean };
export const FROZEN_CAPTURE_CLI_USAGE = `Usage:
  npm run history:capture:catalog -- --output /absolute/path/new-private-directory

Fixed public source: MOEX SBER/TQBR, one-minute candles.
Fixed window: [2025-08-01T00:00:00.000Z, 2026-09-27T00:00:00.000Z).
The output directory must not exist; its parent must already exist.
Bounded HTTPS capture preserves raw response bytes and their provenance.
Creates a NEW finalized allowlisted database; never opens the old research database.
No .env, broker credentials, account operations, retries/resume or orders.
Captured OHLCV is development-only, not executable bid/ask or new OOS evidence.`;

export function parseFrozenCaptureArgs(args: readonly string[]): FrozenCaptureCliOptions {
  const options: FrozenCaptureCliOptions = { outputDirectory: null, help: false };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (argument === '--help' || argument === '-h') { options.help = true; continue; }
    const separator = argument.indexOf('=');
    const flag = separator < 0 ? argument : argument.slice(0, separator);
    if (flag !== '--output' || options.outputDirectory !== null) throw new Error('Unknown or repeated frozen capture option');
    const value = separator < 0 ? args[++index] : argument.slice(separator + 1);
    if (!value || !isAbsolute(value) || value.includes('\0') || value.length > 4096) throw new Error('An absolute new output directory is required');
    options.outputDirectory = value;
  }
  return options;
}

export async function runFrozenCaptureCli(options: FrozenCaptureCliOptions) {
  if (!options.outputDirectory || !isAbsolute(options.outputDirectory) || options.outputDirectory.includes('\0')
    || options.outputDirectory.length > 4096) throw new Error('An explicit absolute --output is required');
  let lastReportedPage = -1;
  const result = await captureFrozenMoexMinuteSource({ outputDirectory: options.outputDirectory,
    onProgress: progress => {
      if (progress.pages % 20 === 0 && progress.pages !== lastReportedPage) {
        lastReportedPage = progress.pages;
        process.stderr.write(`${JSON.stringify({ phase: progress.phase, year: progress.year,
          pages: progress.pages, rows: progress.rows, bytes: progress.bytes })}\n`);
      }
    } });
  return { ...result, ordersSubmitted: false as const };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const options = parseFrozenCaptureArgs(process.argv.slice(2));
    if (options.help) process.stdout.write(`${FROZEN_CAPTURE_CLI_USAGE}\n`);
    else process.stdout.write(`${JSON.stringify(await runFrozenCaptureCli(options), null, 2)}\n`);
  } catch (error) {
    // Filesystem/network errors can contain private paths or injected remote text.
    const reason = error instanceof FrozenMoexCaptureError ? error.code : 'invalid-input-or-local-failure';
    process.stderr.write(`${JSON.stringify({ result: 'refused', reason, finalized: false, ordersSubmitted: false })}\n`);
    process.exitCode = 1;
  }
}
