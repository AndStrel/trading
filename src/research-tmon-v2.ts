import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readCachedTmonDay, tmon2025Weekdays } from './research-tmon-2025-source.js';
import { readCachedTmon2026Day, tmon2026Weekdays } from './research-tmon-2026-source.js';
import { evaluateTmonV2Day, summarizeTmonV2, tmonLongReturn } from './research/tmon-intraday-v2.js';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const checkHash = (path: string, expected: string) => {
  const actual = hash(readFileSync(path));
  if (actual !== expected) throw new Error(`Changed source or coverage ${path}`);
  return actual;
};
const source2025Sha256 = checkHash(join(process.cwd(), '.trading', 'tmon-2025-source.json'),
  '05cfe825a69277c84b1243fb1c8084840853a174bf39b8a4efdaeb6b195a1b7f');
const source2026Sha256 = checkHash(join(process.cwd(), '.trading', 'tmon-2026-source.json'),
  '1af6cf14621282f93be857d1ab06df9e269b64f53bb842691d93e82a81ddd521');
const coverageSha256 = checkHash(join(process.cwd(), '.trading', 'tmon-v2-coverage.json'),
  'd6dc33c01857c707e9635bd79bb64ec0b30f0a57c511234a49e43ffa771f3081');
const protocolSha256 = hash(readFileSync(join(process.cwd(), 'docs', 'TMON_INTRADAY_CARRY_V2.md')));

function evaluatePeriod(dates: string[], readDay: (date: string) => { candles: Parameters<typeof evaluateTmonV2Day>[1] }) {
  const decisions = dates.map((date) => evaluateTmonV2Day(date, readDay(date).candles));
  const unresolved = decisions.filter((decision) => decision.status === 'unresolved_exit').length;
  if (unresolved !== 0) throw new Error('Unresolved exits: refuse price-only strategy score');
  const trades = decisions.filter((decision) => decision.status === 'trade');
  const summary = summarizeTmonV2(decisions);
  const firstHalf = summarizeTmonV2(trades.filter((decision) => decision.date.slice(5, 7) <= '06'));
  const secondHalf = summarizeTmonV2(trades.filter((decision) => decision.date.slice(5, 7) >= '07'));
  const first = trades[0];
  const last = trades.at(-1);
  const continuousHoldProxy = first && last ? {
    from: first.date, to: last.date,
    baseReturn: tmonLongReturn(first.entry!, last.exit!, 0.00005),
    stressReturn: tmonLongReturn(first.entry!, last.exit!, 0.0001),
  } : null;
  const screenPass = summary.trades >= 100 && summary.baseWinRate !== null && summary.baseWinRate >= 0.51 &&
    summary.stressWinRate !== null && summary.stressWinRate >= 0.51 &&
    summary.meanBaseNet !== null && summary.meanBaseNet > 0 &&
    summary.meanStressNet !== null && summary.meanStressNet > 0 &&
    firstHalf.meanBaseNet !== null && firstHalf.meanBaseNet > 0 &&
    firstHalf.meanStressNet !== null && firstHalf.meanStressNet > 0 &&
    secondHalf.meanBaseNet !== null && secondHalf.meanBaseNet > 0 &&
    secondHalf.meanStressNet !== null && secondHalf.meanStressNet > 0 &&
    summary.baseWithoutBestFiveSum !== null && summary.baseWithoutBestFiveSum > 0 &&
    summary.stressWithoutBestFiveSum !== null && summary.stressWithoutBestFiveSum > 0;
  return { coverage: { weekdays: dates.length, inactive: decisions.filter((decision) => decision.status === 'inactive').length,
    cancelledEntries: decisions.filter((decision) => decision.status === 'cancelled_entry').length, unresolved },
    summary, firstHalf, secondHalf, continuousHoldProxy, screenPass, decisions };
}

const year2025 = evaluatePeriod(tmon2025Weekdays(), readCachedTmonDay);
const year2026 = evaluatePeriod(tmon2026Weekdays(), readCachedTmon2026Day);
if (year2025.summary.trades !== 184 || year2026.summary.trades !== 152) throw new Error('Trade counts differ from timestamp-only coverage');
const report = { protocol: 'docs/TMON_INTRADAY_CARRY_V2.md', protocolSha256,
  source2025Sha256, source2026Sha256, coverageSha256, year2025, year2026 };
const body = `${JSON.stringify(report, null, 2)}\n`;
const path = join(process.cwd(), '.trading', 'tmon-v2-results.json');
writeFileSync(path, body, { mode: 0o600 });
process.stdout.write(JSON.stringify({ path, sha256: hash(body), year2025: { coverage: year2025.coverage,
  summary: year2025.summary, firstHalf: year2025.firstHalf, secondHalf: year2025.secondHalf,
  continuousHoldProxy: year2025.continuousHoldProxy, screenPass: year2025.screenPass },
year2026: { coverage: year2026.coverage, summary: year2026.summary, firstHalf: year2026.firstHalf,
  secondHalf: year2026.secondHalf, continuousHoldProxy: year2026.continuousHoldProxy,
  screenPass: year2026.screenPass } }) + '\n');
