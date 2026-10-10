import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readCachedTDay, t2025Weekdays } from './research-t-2025-source.js';
import { evaluateTMorningStrength, summarizeTMorningStrength } from './research/t-morning-strength.js';

const hash = (body: string) => createHash('sha256').update(body).digest('hex');
const protocolPath = join(process.cwd(), 'docs', 'T_MORNING_STRENGTH_V1.md');
const outputPath = join(process.cwd(), '.trading', 't-morning-strength-v1-2025.json');
const decisions = t2025Weekdays().map((date) => evaluateTMorningStrength(date, readCachedTDay(date).candles));
const report = { protocolSha256: hash(readFileSync(protocolPath, 'utf8')),
  source: 'MOEX ISS T TQBR 2025 frozen local trade-candle archive',
  summary: summarizeTMorningStrength(decisions), decisions };
const body = `${JSON.stringify(report, null, 2)}\n`;
writeFileSync(outputPath, body, { mode: 0o600 });
console.log(JSON.stringify({ outputPath, sha256: hash(body), summary: report.summary }));
