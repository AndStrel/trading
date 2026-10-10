import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateBrLateMomentum, summarizeBrLateMomentum, type BrLateDecision } from './research/br-late-session-momentum.js';
import { br2026DaySpecs, readCachedBrDay } from './research-br-2026-source.js';
import { readCachedBrLate } from './research-br-2026-late-source.js';

const specialDates = new Set(['2026-05-01', '2026-06-12']);
const sourceHashes = Object.fromEntries(['br-2026-continuous-source.json', 'br-2026-late-source.json'].map((filename) =>
  [filename, createHash('sha256').update(readFileSync(join('.trading', filename))).digest('hex')]));
const decisions: BrLateDecision[] = br2026DaySpecs().map((spec) => {
  if (specialDates.has(spec.date)) return { date: spec.date, contract: spec.contract, status: 'excluded', reason: 'special_session' };
  return evaluateBrLateMomentum({ date: spec.date, contract: spec.contract,
    baseCandles: readCachedBrDay(spec).candles, lateCandles: readCachedBrLate(spec).candles });
});
const report = { protocol: 'docs/BR_LATE_SESSION_MOMENTUM_V1.md', sourceHashes,
  summary: summarizeBrLateMomentum(decisions), decisions };
const output = join('.trading', 'br-late-session-momentum-v1.json');
const body = `${JSON.stringify(report, null, 2)}\n`;
writeFileSync(output, body, { mode: 0o600 });
console.log(JSON.stringify({ output, sha256: createHash('sha256').update(body).digest('hex'), summary: report.summary }));
