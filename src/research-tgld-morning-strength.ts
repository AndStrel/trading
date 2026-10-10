import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readCachedTgldDay, tgldWeekdays } from './research-tgld-2025-source.js';
import { evaluateTgldMorningStrength, summarizeTgldMorningStrength } from './research/tgld-morning-strength.js';

const hash = (body: string) => createHash('sha256').update(body).digest('hex');
const protocolPath = join(process.cwd(), 'docs', 'TGLD_MORNING_STRENGTH_V1.md');
const outputPath = join(process.cwd(), '.trading', 'tgld-morning-strength-v1-2024.json');
const decisions = tgldWeekdays('2024').map((date) => evaluateTgldMorningStrength(date, readCachedTgldDay('2024', date).candles));
const report = { protocolSha256: hash(readFileSync(protocolPath, 'utf8')),
  source: 'MOEX ISS TGLD TQTF 2024 frozen local trade-candle archive',
  summary: summarizeTgldMorningStrength(decisions), decisions };
const body = `${JSON.stringify(report, null, 2)}\n`;
writeFileSync(outputPath, body, { mode: 0o600 });
console.log(JSON.stringify({ outputPath, sha256: hash(body), summary: report.summary }));
