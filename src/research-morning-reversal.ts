import { readFileSync, writeFileSync } from 'node:fs';
import { digest, loadVerifiedCandles } from './research/verified-candles.js';
import { morningReversal } from './research/morning-reversal.js';
import { costScenarios, breakEvenGrossPct, eventReturnPct } from './research/trading-costs.js';
import { summarizeSignals } from './research/similarity-experiment.js';

const protocolSha256 = digest(readFileSync('docs/MORNING_REVERSAL_V1.md'));
if (protocolSha256 !== 'c15057e4687186f798b89a3a4e9a8873bce1a555eb34d6b17a5e69670da44e9b') {
  throw new Error('Frozen morning-reversal-v1 protocol changed');
}
const gapAuditBytes = readFileSync('.trading/trading-gap-audit.json');
const gapAudit = JSON.parse(gapAuditBytes.toString()) as { evidenceSha256: string; summary: { unverified: number; disagreement: number } };
if (gapAudit.summary.unverified !== 0 || gapAudit.summary.disagreement !== 0 ||
  gapAudit.evidenceSha256 !== digest(readFileSync('.trading/gap-reference-times.json'))) {
  throw new Error('Unverified gap audit or changed independent evidence');
}
const sources = loadVerifiedCandles();
// Controls are reported separately; no selecting a winning variant after the fact.
const comparisons = [false, true].map((control) => {
  const years = [2024, 2025].map((year) => {
    const results = sources.filter((a) => a.year === year).map((a) => morningReversal(a.ticker, a.data, control));
    const trades = results.flatMap((r) => r.trades);
    const summary = (key: 'netPct' | 'stressPct' | 'extremePct' | 'grossPct' | 'investorFeeOnlyPct' | 'traderBeforeSubscriptionPct') =>
      summarizeSignals(trades.map((t) => ({ ...t, netPct: t[key] })), 'netPct');
    return { year, decisions: results.flatMap((r) => r.decisions), trades,
      cancelled: results.flatMap((r) => r.cancelled), unclosed: results.flatMap((r) => r.unclosed),
      blockedHistory: results.flatMap((r) => r.blockedHistory), weekendDays: results.reduce((s, r) => s + r.weekendDays, 0),
      base: summary('netPct'), stress: summary('stressPct'), extreme: summary('extremePct'), gross: summary('grossPct'),
      feeOnly: summary('investorFeeOnlyPct'), trader: summary('traderBeforeSubscriptionPct') };
  });
  const combined = summarizeSignals(years.flatMap((y) => y.trades), 'netPct');
  const reasons: string[] = [];
  if (years.some((y) => y.cancelled.length || y.unclosed.length)) reasons.push('unresolved-execution');
  if (combined.trades < 100 || combined.days < 50) reasons.push('insufficient-signals-or-dates');
  if (years.some((y) => [y.base, y.stress].some((m) => m.averageNetPct === null || m.averageNetPct <= 0 ||
    m.positiveSumPct <= m.negativeSumPct || m.withoutBestDaySumPct <= 0 || m.withoutBestTickerSumPct <= 0))) reasons.push('nonpositive-or-fragile-year');
  const gate = { status: reasons.length ? 'rejected-at-primary-gate' : 'eligible-for-portfolio-test', reasons, combined };
  return { strategy: control ? 'same-time-control' : 'morning-reversal-v1', ...gate, years };
});
// Reprice the prior, frozen experiment separately. Never rewrite its original report.
const hourly = JSON.parse(readFileSync('.trading/hourly-trend-v1.json', 'utf8')) as {
  comparisons: { kind: string; years: { year: number; incomplete: string[]; trades: { day: string; ticker: string; entry: number; exit: number }[] }[] }[] };
const costAudit = hourly.comparisons.map((c) => ({ model: c.kind, years: c.years.map((y) => ({ year: y.year,
  incomplete: y.incomplete.length, scenarios: Object.fromEntries(Object.entries(costScenarios).map(([name, costs]) =>
    [name, summarizeSignals(y.trades.map((t) => ({ ...t, netPct: eventReturnPct(t.entry, t.exit, costs), stressPct: 0, extremePct: 0 })), 'netPct')])) })) }));
const report = { experiment: 'morning-reversal-v1', protocolSha256, gapAuditSha256: digest(gapAuditBytes),
  codeSha256: digest(Buffer.concat(['src/research-morning-reversal.ts', 'src/research/morning-reversal.ts',
    'src/research/trading-costs.ts', 'src/research/verified-candles.ts',
    'src/research/similarity-experiment.ts'].map((p) => readFileSync(p)))),
  interpretation: 'Research event returns, NOT portfolio returns, before income tax. Trader scenario excludes subscription.',
  scenarios: Object.fromEntries(Object.entries(costScenarios).map(([name, costs]) => [name, { ...costs, breakEvenGrossPct: breakEvenGrossPct(costs) }])),
  sources: sources.map(({ data, ...source }) => source), comparisons, costAudit };
writeFileSync('.trading/morning-reversal-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ protocolSha256, scenarios: report.scenarios, comparisons: comparisons.map((c) => ({
  strategy: c.strategy, status: c.status, reasons: c.reasons, combined: c.combined,
  years: c.years.map(({ decisions, trades, ...rest }) => ({ ...rest, decisions: decisions.length,
    delayedExits: trades.filter((t) => t.exitDelayMinutes > 0).length, interiorGaps: trades.filter((t) => t.interiorMissingMinutes > 0).length })) })) }, null, 2));
