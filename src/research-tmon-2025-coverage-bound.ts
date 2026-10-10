import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readCachedTmonDay, tmon2025Weekdays } from './research-tmon-2025-source.js';
import { tmonCoverageBound } from './research/tmon-coverage-bound.js';

const sourceManifestPath = join(process.cwd(), '.trading', 'tmon-2025-source.json');
const sourceManifestSha256 = createHash('sha256').update(readFileSync(sourceManifestPath)).digest('hex');
if (sourceManifestSha256 !== '05cfe825a69277c84b1243fb1c8084840853a174bf39b8a4efdaeb6b195a1b7f') {
  throw new Error('TMON source manifest changed');
}
const days = tmon2025Weekdays().map((date) => ({ date, candles: readCachedTmonDay(date).candles }));
const result = tmonCoverageBound(days);
if (result.activeDays !== 253 || result.enteredDays !== 184 || result.completedDays !== 141 || result.unresolvedExits !== 43) {
  throw new Error('TMON source coverage differs from the frozen protocol');
}
const report = { protocol: 'docs/TMON_2025_COVERAGE_BOUND_PROTOCOL.md', source: '.trading/tmon-2025-source.json',
  sourceManifestSha256,
  result };
const body = `${JSON.stringify(report, null, 2)}\n`;
const path = join(process.cwd(), '.trading', 'tmon-2025-coverage-bound.json');
writeFileSync(path, body, { mode: 0o600 });
process.stdout.write(JSON.stringify({ path, sha256: createHash('sha256').update(body).digest('hex'), result }) + '\n');
