import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readCachedSi2026Day, si2026DaySpecs } from './research-si-2026-source.js';
import { readCachedSi2026EveningDay } from './research-si-2026-evening-source.js';
import { evaluateSiUsSessionDay, summarizeSiUsSessionBound } from './research/si-us-session-continuation.js';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const checkHash = (path: string, expected: string) => {
  const actual = hash(readFileSync(path));
  if (actual !== expected) throw new Error(`Changed source ${path}`);
  return actual;
};
const daytimeSourceSha256 = checkHash(join(process.cwd(), '.trading', 'si-2026-continuous-source.json'),
  'ed8c32be0f099e8caeb8d773b6edaa7cac08e397c326fe2135ba810e56c36b74');
const eveningSourceSha256 = checkHash(join(process.cwd(), '.trading', 'si-2026-evening-source.json'),
  'f009a75d32eea6665e42abd14088c66b11d75e95f7644c2c4970f8bbb5d79a02');
const specs = si2026DaySpecs().filter((spec) => spec.date !== '2026-05-01' && spec.date !== '2026-06-12');
const decisions = specs.map((spec) => evaluateSiUsSessionDay(spec,
  readCachedSi2026Day(spec).candles, readCachedSi2026EveningDay(spec).candles));
const summary = summarizeSiUsSessionBound(decisions);
if (summary.decisions !== 133 || summary.missingHistory !== 0 || summary.cancelledEntry !== 0) {
  throw new Error('Si session coverage differs from timestamp checkpoint');
}
const byContract = Object.fromEntries(['SiM6', 'SiU6', 'SiZ6'].map((contract) => [contract,
  summarizeSiUsSessionBound(decisions.filter((decision) => decision.contract === contract))]));
const bySide = Object.fromEntries(['long', 'short'].map((side) => [side,
  summarizeSiUsSessionBound(decisions.filter((decision) => decision.side === side))]));
const report = { protocol: 'docs/SI_US_SESSION_CONTINUATION_V1.md',
  boundProtocol: 'docs/SI_US_SESSION_MISSING_EXIT_BOUND_PROTOCOL.md',
  daytimeSourceSha256, eveningSourceSha256, summary, byContract, bySide, decisions };
const body = `${JSON.stringify(report, null, 2)}\n`;
const path = join(process.cwd(), '.trading', 'si-us-session-continuation-v1.json');
writeFileSync(path, body, { mode: 0o600 });
process.stdout.write(JSON.stringify({ path, sha256: hash(body), summary, byContract, bySide }) + '\n');
