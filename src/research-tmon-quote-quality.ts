import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeTmonQuoteAttempts } from './research/tmon-quote-quality.js';

const source = join(process.cwd(), '.trading', 'quotes', 'moex-delayed-TMON-attempts.jsonl');
if (!existsSync(source)) throw new Error('No TMON quote attempts yet');
const content = readFileSync(source);
const lines = content.toString('utf8').split('\n');
const summary = analyzeTmonQuoteAttempts(lines);
const report = { source, sourceSha256: createHash('sha256').update(content).digest('hex'),
  interpretation: 'MOEX ISS delayed top-of-book observations only; not executable quote or fill evidence', summary };
const body = `${JSON.stringify(report, null, 2)}\n`;
const output = join(process.cwd(), '.trading', 'quotes', 'tmon-quote-quality.json');
writeFileSync(output, body, { mode: 0o600 });
process.stdout.write(JSON.stringify({ output, reportSha256: createHash('sha256').update(body).digest('hex'), summary }) + '\n');
