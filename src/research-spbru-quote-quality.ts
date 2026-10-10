import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeSpbruQuoteAttempts } from './research/spbru-quote-quality.js';

const source = join(process.cwd(), '.trading', 'quotes-spbru', 'tmon-spbru-attempts.jsonl');
if (!existsSync(source)) throw new Error('No SPBRU quote attempts yet');
const content = readFileSync(source);
const summary = analyzeSpbruQuoteAttempts(content.toString('utf8').split('\n'));
const report = { source, sourceSha256: createHash('sha256').update(content).digest('hex'),
  interpretation: 'T-Invest SPBRU unary top-of-book observations only; not executable-fill evidence', summary };
const body = `${JSON.stringify(report, null, 2)}\n`;
const output = join(process.cwd(), '.trading', 'quotes-spbru', 'tmon-spbru-quality.json');
writeFileSync(output, body, { mode: 0o600 });
process.stdout.write(`${JSON.stringify({ output, reportSha256: createHash('sha256').update(body).digest('hex'), summary })}\n`);
