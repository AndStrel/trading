import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { evaluateBrFirstHourReversal, summarizeBrFirstHourReversal } from './research/br-first-hour-reversal.js';
import { br2024DaySpecs, readCachedBr2024Day } from './research-br-2024-source.js';
import { br2025DaySpecs, readCachedBr2025Day } from './research-br-2025-source.js';

function sha(path: string) { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
function main() {
  const protocolPath = 'docs/BR_FIRST_HOUR_REVERSAL_2024_2025_EXPLORATORY_V1.md';
  const manifestPaths = ['.trading/br-2024-continuous-source.json', '.trading/br-2025-continuous-source.json'];
  const decisions = [
    ...br2024DaySpecs().filter((s) => s.date >= '2024-03-24' && s.date <= '2024-09-25')
      .map((s) => evaluateBrFirstHourReversal(s.date, s.contract, readCachedBr2024Day(s).candles)),
    ...br2025DaySpecs().map((s) => evaluateBrFirstHourReversal(s.date, s.contract, readCachedBr2025Day(s).candles)),
  ];
  const group = (key: (d: (typeof decisions)[number]) => string) => Object.fromEntries([...new Set(decisions.map(key))].sort().map((name) => [name, summarizeBrFirstHourReversal(decisions.filter((d) => key(d) === name))]));
  const output = {
    protocolSha256: sha(protocolPath),
    manifests: Object.fromEntries(manifestPaths.map((p) => [p, sha(p)])),
    overall: summarizeBrFirstHourReversal(decisions),
    years: group((d) => d.date.slice(0, 4)),
    contracts: group((d) => d.contract),
    sides: group((d) => d.side ?? d.status),
    unresolved: decisions.filter((d) => d.status === 'unresolved_holding' || d.status === 'cancelled_entry'),
  };
  const text = `${JSON.stringify(output, null, 2)}\n`;
  writeFileSync('.trading/br-first-hour-reversal-2024-2025-exploratory-v1.json', text, { mode: 0o600 });
  console.log(text);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
