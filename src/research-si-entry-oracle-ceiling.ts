import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readCachedSi2026Day, si2026DaySpecs } from './research-si-2026-source.js';
import { siEntryOracleCeilingDay, summarizeSiOracleCeiling } from './research/si-entry-oracle-ceiling.js';

const sourceSha256 = createHash('sha256').update(readFileSync(join(process.cwd(), '.trading', 'si-2026-continuous-source.json'))).digest('hex');
if (sourceSha256 !== 'ed8c32be0f099e8caeb8d773b6edaa7cac08e397c326fe2135ba810e56c36b74') throw new Error('Si source report changed');
const specs = si2026DaySpecs().filter((spec) => spec.date !== '2026-05-01' && spec.date !== '2026-06-12');
const days = specs.map((spec) => siEntryOracleCeilingDay(spec, readCachedSi2026Day(spec).candles));
const continuation = summarizeSiOracleCeiling(days, 'continuation');
const reversal = summarizeSiOracleCeiling(days, 'reversal');
const report = { protocol: 'docs/SI_1101_ENTRY_ORACLE_CEILING_PROTOCOL.md', sourceSha256, continuation, reversal, days };
const body = `${JSON.stringify(report, null, 2)}\n`;
const output = join(process.cwd(), '.trading', 'si-1101-entry-oracle-ceiling.json');
writeFileSync(output, body, { mode: 0o600 });
process.stdout.write(JSON.stringify({ output, sha256: createHash('sha256').update(body).digest('hex'), continuation, reversal }) + '\n');
