import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateSiMainMomentum, summarizeSiMainMomentum, type MainMomentumDecision } from './research/si-main-session-momentum.js';
import { si2026DaySpecs, readCachedSi2026Day } from './research-si-2026-source.js';
import { readCachedMainHour } from './research-si-2026-main-hour-source.js';

const specialDates = new Set(['2026-05-01', '2026-06-12']);
const specs = si2026DaySpecs();
const sourceHashes = Object.fromEntries(['si-2026-continuous-source.json', 'si-2026-main-hour-source.json'].map((filename) =>
  [filename, createHash('sha256').update(readFileSync(join('.trading', filename))).digest('hex')]));
const decisions: MainMomentumDecision[] = specs.map((spec) => {
  if (specialDates.has(spec.date)) return { date: spec.date, contract: spec.contract, status: 'excluded', reason: 'special_session' };
  return evaluateSiMainMomentum({ date: spec.date, contract: spec.contract,
    signalCandles: readCachedMainHour(spec).candles, holdingCandles: readCachedSi2026Day(spec).candles });
});
const report = { protocol: 'docs/SI_MAIN_SESSION_MOMENTUM_V1.md', sourceHashes,
  summary: summarizeSiMainMomentum(decisions), decisions };
const output = join('.trading', 'si-main-session-momentum-v1.json');
const body = `${JSON.stringify(report, null, 2)}\n`;
writeFileSync(output, body, { mode: 0o600 });
console.log(JSON.stringify({ output, sha256: createHash('sha256').update(body).digest('hex'), summary: report.summary }));
