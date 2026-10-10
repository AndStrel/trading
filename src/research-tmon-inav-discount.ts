import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { si2026DaySpecs } from './research-si-2026-source.js';
import { readCachedTmon2026Day } from './research-tmon-2026-source.js';
import { readCachedInavDay } from './research/tmon-inav-source.js';
import { evaluateTmonDiscountDay, summarizeTmonDiscount } from './research/tmon-inav-discount.js';

function sourceHash(filename: string, expected: string): string {
  const actual = createHash('sha256').update(readFileSync(join(process.cwd(), '.trading', filename))).digest('hex');
  if (actual !== expected) throw new Error(`Changed source ${filename}`);
  return actual;
}
const tmonSourceSha256 = sourceHash('tmon-2026-source.json', '1af6cf14621282f93be857d1ab06df9e269b64f53bb842691d93e82a81ddd521');
const inavSourceSha256 = sourceHash('tmon-inav-2026-source.json', 'e1508ad98f28aae499d187ffb34564b03911ea0f63099683187b9b177463102e');
const dates = si2026DaySpecs().map((spec) => spec.date).filter((date) => date !== '2026-05-01' && date !== '2026-06-12');
const pairedDays = dates.map((date) => ({ date,
  tmon: readCachedTmon2026Day(date).candles, inav: readCachedInavDay(date).candles }));
const decisions = pairedDays.map(({ date, tmon, inav }) => evaluateTmonDiscountDay(date, tmon, inav));
const pairedGaps = pairedDays.flatMap(({ tmon, inav }) => {
  const navByTime = new Map(inav.map((candle) => [candle.time, candle.close]));
  return tmon.flatMap((candle) => {
    const minute = candle.time.slice(11, 16);
    const nav = navByTime.get(candle.time);
    return minute >= '10:15' && minute <= '14:00' && nav !== undefined ? [candle.close / nav - 1] : [];
  });
});
const gapDiagnostic = { pairedMinutes: pairedGaps.length,
  belowInavMinutes: pairedGaps.filter((gap) => gap < 0).length,
  minimumGap: pairedGaps.length ? Math.min(...pairedGaps) : null,
  maximumGap: pairedGaps.length ? Math.max(...pairedGaps) : null };
const summary = summarizeTmonDiscount(decisions);
const byBlock = {
  marchMay: summarizeTmonDiscount(decisions.filter((decision) => decision.date < '2026-06-01')),
  juneSeptember: summarizeTmonDiscount(decisions.filter((decision) => decision.date >= '2026-06-01')),
};
const report = { protocol: 'docs/TMON_INAV_DISCOUNT_V1.md', tmonSourceSha256, inavSourceSha256, summary, gapDiagnostic, byBlock, decisions };
const body = `${JSON.stringify(report, null, 2)}\n`;
const output = join(process.cwd(), '.trading', 'tmon-inav-discount-v1.json');
writeFileSync(output, body, { mode: 0o600 });
process.stdout.write(`${JSON.stringify({ output, sha256: createHash('sha256').update(body).digest('hex'), summary, gapDiagnostic, byBlock })}\n`);
