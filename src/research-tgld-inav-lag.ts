import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tgld2026DaySpecs, readCachedTgldDay } from './research-tgld-2026-feasibility.js';
import { readCachedTgldInavDay } from './research/tgld-inav-source.js';
import { evaluateTgldInavLag, summarizeTgldInavLag } from './research/tgld-inav-lag.js';

function verify(name: string, expected: string): string {
  const actual = createHash('sha256').update(readFileSync(join(process.cwd(), '.trading', name))).digest('hex');
  if (actual !== expected) throw new Error(`Changed source ${name}`);
  return actual;
}
const fundSourceSha256 = verify('tgld-2026-feasibility.json', '1baacb89255d94003992d01cb0236924ea8963767b65cd87a3f0382dfca13210');
const navSourceSha256 = verify('tgld-inav-2026-source.json', '47704b65734c19f9ebd2b545bd035615b4fb9a219827bcab5f2add8fd7bc5abc');
const decisions = tgld2026DaySpecs().map((spec) => evaluateTgldInavLag(spec.date,
  readCachedTgldDay(spec).candles, readCachedTgldInavDay(spec.date).candles));
const summary = summarizeTgldInavLag(decisions);
const byBlock = { marchMay: summarizeTgldInavLag(decisions.filter((decision) => decision.date < '2026-06-01')),
  juneSeptember: summarizeTgldInavLag(decisions.filter((decision) => decision.date >= '2026-06-01')) };
const report = { protocol: 'docs/TGLD_INAV_LAG_V1.md', fundSourceSha256, navSourceSha256, summary, byBlock, decisions };
const body = `${JSON.stringify(report, null, 2)}\n`;
const output = join(process.cwd(), '.trading', 'tgld-inav-lag-v1.json');
writeFileSync(output, body, { mode: 0o600 });
process.stdout.write(`${JSON.stringify({ output, sha256: createHash('sha256').update(body).digest('hex'), summary, byBlock })}\n`);
