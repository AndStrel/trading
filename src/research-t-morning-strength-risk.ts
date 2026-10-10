import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readCachedT2024Day, t2024DaySpecs } from './research-t-2024-source.js';
import { evaluateTMorningStrengthRisk, summarizeTMorningStrengthRisk } from './research/t-morning-strength-risk.js';

const hash = (body: string) => createHash('sha256').update(body).digest('hex');
const protocolPath = join(process.cwd(), 'docs', 'T_MORNING_STRENGTH_RISK_V2.md');
const outputPath = join(process.cwd(), '.trading', 't-morning-strength-risk-v2-2024.json');
const decisions = t2024DaySpecs().map((spec) => evaluateTMorningStrengthRisk({ ...spec,
  candles: readCachedT2024Day(spec).candles }));
const report = { protocolSha256: hash(readFileSync(protocolPath, 'utf8')),
  source: 'MOEX ISS TCSG/T TQBR 2024 frozen local trade-candle archive',
  summary: summarizeTMorningStrengthRisk(decisions), decisions };
const body = `${JSON.stringify(report, null, 2)}\n`;
writeFileSync(outputPath, body, { mode: 0o600 });
console.log(JSON.stringify({ outputPath, sha256: hash(body), summary: report.summary }));
