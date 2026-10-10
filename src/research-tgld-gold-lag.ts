import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateTgldGoldLag, summarizeTgldGoldLag } from './research/tgld-gold-lag.js';
import { readCachedGoldDay } from './research-gold-spot-2026-source.js';
import { readCachedTgldDay, tgld2026DaySpecs } from './research-tgld-2026-feasibility.js';

const sourceHashes = Object.fromEntries(['tgld-2026-feasibility.json', 'gold-spot-2026-source.json'].map((filename) =>
  [filename, createHash('sha256').update(readFileSync(join('.trading', filename))).digest('hex')]));
const decisions = tgld2026DaySpecs().map((spec) => evaluateTgldGoldLag({ date: spec.date,
  fundCandles: readCachedTgldDay(spec).candles, goldCandles: readCachedGoldDay(spec.date).candles }));
const report = { protocol: 'docs/TGLD_GOLD_LAG_V1.md', sourceHashes, summary: summarizeTgldGoldLag(decisions), decisions };
const output = join('.trading', 'tgld-gold-lag-v1.json');
const body = `${JSON.stringify(report, null, 2)}\n`;
writeFileSync(output, body, { mode: 0o600 });
console.log(JSON.stringify({ output, sha256: createHash('sha256').update(body).digest('hex'), summary: report.summary }));
