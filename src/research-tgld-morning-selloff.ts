import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readCachedTgld2025Day, tgld2025Weekdays } from './research-tgld-2025-source.js';
import { evaluateTgldMorningSelloff, summarizeTgldMorningSelloff } from './research/tgld-morning-selloff.js';

const hash = (body: string) => createHash('sha256').update(body).digest('hex');
const protocolPath = join(process.cwd(), 'docs', 'TGLD_MORNING_SELLOFF_V1.md');
const outputPath = join(process.cwd(), '.trading', 'tgld-morning-selloff-v1-2025.json');
const decisions = tgld2025Weekdays().map((date) => evaluateTgldMorningSelloff(date, readCachedTgld2025Day(date).candles));
const report = { protocolSha256: hash(readFileSync(protocolPath, 'utf8')), source: 'MOEX ISS TGLD TQTF 2025 frozen local trade-candle archive',
  summary: summarizeTgldMorningSelloff(decisions), decisions };
const body = `${JSON.stringify(report, null, 2)}\n`;
writeFileSync(outputPath, body, { mode: 0o600 });
console.log(JSON.stringify({ outputPath, sha256: hash(body), summary: report.summary }));
