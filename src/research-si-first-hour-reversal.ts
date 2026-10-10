import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readCachedSi2026Day, si2026DaySpecs } from './research-si-2026-source.js';
import { evaluateSiReversalDay, summarizeSiReversal } from './research/si-first-hour-reversal.js';

const sourcePath = join(process.cwd(), '.trading', 'si-2026-continuous-source.json');
const sourceSha256 = createHash('sha256').update(readFileSync(sourcePath)).digest('hex');
if (sourceSha256 !== 'ed8c32be0f099e8caeb8d773b6edaa7cac08e397c326fe2135ba810e56c36b74') {
  throw new Error('Si source report changed');
}
const specs = si2026DaySpecs().filter((spec) => spec.date !== '2026-05-01' && spec.date !== '2026-06-12');
const decisions = specs.map((spec) => evaluateSiReversalDay(spec, readCachedSi2026Day(spec).candles));
const summary = summarizeSiReversal(decisions);
const byContract = Object.fromEntries(['SiM6', 'SiU6', 'SiZ6'].map((contract) => [contract,
  summarizeSiReversal(decisions.filter((decision) => decision.contract === contract))]));
const byBlock = {
  'March–June': summarizeSiReversal(decisions.filter((decision) => decision.date < '2026-07-01')),
  'July–September': summarizeSiReversal(decisions.filter((decision) => decision.date >= '2026-07-01')),
};
const report = { protocol: 'docs/SI_FIRST_HOUR_REVERSAL_V1.md', sourceSha256, summary, byContract, byBlock, decisions };
const body = `${JSON.stringify(report, null, 2)}\n`;
const output = join(process.cwd(), '.trading', 'si-first-hour-reversal-v1.json');
writeFileSync(output, body, { mode: 0o600 });
process.stdout.write(JSON.stringify({ output, sha256: createHash('sha256').update(body).digest('hex'), summary, byContract, byBlock }) + '\n');
