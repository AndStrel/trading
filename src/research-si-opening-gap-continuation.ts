import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateSiOpeningGap, summarizeSiOpeningGap, type GapDecision } from './research/si-opening-gap-continuation.js';
import { readCachedSi2026Day, si2026DaySpecs } from './research-si-2026-source.js';

const specs = si2026DaySpecs();
const sourceReport = readFileSync(join('.trading', 'si-2026-continuous-source.json'));
const sourceSha256 = createHash('sha256').update(sourceReport).digest('hex');
const days = specs.map((spec) => ({ ...spec, candles: readCachedSi2026Day(spec).candles }));
const decisions: GapDecision[] = days.map((day, index) => {
  const previous = days[index - 1];
  if (!previous) return { date: day.date, contract: day.contract, status: 'excluded', reason: 'first_source_day' };
  return evaluateSiOpeningGap({ date: day.date, contract: day.contract, previousDate: previous.date,
    previousContract: previous.contract, previousCandles: previous.candles, candles: day.candles });
});
const report = {
  protocol: 'docs/SI_OPENING_GAP_CONTINUATION_V1.md',
  sourceSha256,
  summary: summarizeSiOpeningGap(decisions),
  decisions,
};
mkdirSync('.trading', { recursive: true, mode: 0o700 });
const output = join('.trading', 'si-opening-gap-continuation-v1.json');
const body = `${JSON.stringify(report, null, 2)}\n`;
writeFileSync(output, body, { mode: 0o600 });
console.log(JSON.stringify({ output, sha256: createHash('sha256').update(body).digest('hex'), summary: report.summary }));
