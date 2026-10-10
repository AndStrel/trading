import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readCachedTrurDay, weekdays2025 } from './research-trur-2025.js';
import { trurMissingExitBound } from './research/trur-missing-exit-bound.js';

const sourcePath = join(process.cwd(), '.trading', 'trur-2025-source.json');
const sourceSha256 = createHash('sha256').update(readFileSync(sourcePath)).digest('hex');
if (sourceSha256 !== 'e5128b98d3d9f2252300156de49128744ff1e32de7736ce1bfedec84e255fd56') {
  throw new Error('TRUR source manifest changed');
}
const days = weekdays2025().map((date) => ({ date, candles: readCachedTrurDay(date).candles }));
const result = trurMissingExitBound(days);
if (result.activeDays !== 253 || result.enteredDays !== 247 || result.completedDays !== 238 || result.unresolvedExits !== 9) {
  throw new Error('TRUR coverage differs from the frozen protocol');
}
const report = { protocol: 'docs/TRUR_2025_MISSING_EXIT_BOUND_PROTOCOL.md', sourceSha256, result };
const body = `${JSON.stringify(report, null, 2)}\n`;
const path = join(process.cwd(), '.trading', 'trur-2025-bound.json');
writeFileSync(path, body, { mode: 0o600 });
process.stdout.write(JSON.stringify({ path, sha256: createHash('sha256').update(body).digest('hex'), result }) + '\n');
