import { readFileSync, writeFileSync } from 'node:fs';
import { digest, loadVerifiedCandles } from './research/verified-candles.js';
import { mechanisms, morningFrame, mechanismSignals, executeDiscovery, discoveryStats, blockIntervals,
  type MorningFrame, type DiscoveryTrade, type Mechanism } from './research/mechanism-discovery.js';

const protocolSha256 = digest(readFileSync('docs/MECHANISM_DISCOVERY_V1.md'));
if (protocolSha256 !== 'b4a4dd34f6f0ab43d9d99b77bda19bcde536eee10015c97fa6ad0d963a1edbc1') throw new Error('Frozen discovery protocol changed');
const sources = loadVerifiedCandles();
const records = new Map(mechanisms.map((m) => [m, { trades: [] as DiscoveryTrade[], unresolved: [] as unknown[] }]));
const data = ['SBER', 'GAZP'].map((ticker) => ({ ticker, byTime: new Map(sources.filter((s) => s.ticker === ticker)
  .flatMap((s) => s.data).map((c) => [Date.parse(c.time), c])) }));
const dates = [...new Set(data.flatMap(({ byTime }) => [...byTime.keys()].map((t) => new Date(t + 10800_000).toISOString().slice(0, 10))))].sort();
const history: [MorningFrame, MorningFrame][] = [];
const decisions: unknown[] = [], blockedHistory: string[] = [];
for (const day of dates) {
  if ([0, 6].includes(new Date(day).getUTCDay())) continue;
  const a = morningFrame(data[0]!.ticker, day, data[0]!.byTime), b = morningFrame(data[1]!.ticker, day, data[1]!.byTime);
  if (!a || !b) { blockedHistory.push(day); continue; }
  if (day >= '2024-01-01') for (let i = 0; i < 2; i++) {
    const self = i === 0 ? a : b, other = i === 0 ? b : a;
    const past: [MorningFrame, MorningFrame][] = i === 0 ? history : history.map(([x, y]) => [y, x]);
    const decision = mechanismSignals(self, other, past);
    if (!decision) { blockedHistory.push(`${self.ticker}:${day}:insufficient-history`); continue; }
    decisions.push({ frame: self, ...decision });
    for (const mechanism of mechanisms) if (decision.signals[mechanism]) {
      const result = executeDiscovery(self, data[i]!.byTime);
      if (result.status === 'closed') records.get(mechanism)!.trades.push(result.trade);
      else records.get(mechanism)!.unresolved.push(result);
    }
  }
  history.push([a, b]); // Only after both decisions; never use today's observation in its own norms.
}
const reports = mechanisms.map((mechanism: Mechanism) => {
  const { trades, unresolved } = records.get(mechanism)!;
  const combined = discoveryStats(trades);
  const years = [2024, 2025].map((year) => {
    const rows = trades.filter((t) => t.day.startsWith(String(year)));
    return { year, base: discoveryStats(rows), stress: discoveryStats(rows, 'stress'), trader: discoveryStats(rows, 'trader'), gross: discoveryStats(rows, 'gross') };
  });
  const reasons: string[] = [];
  if (unresolved.length) reasons.push('unresolved-execution');
  if (combined.count < 100 || combined.days < 50) reasons.push('insufficient-sample');
  if (years.some((y) => [y.base, y.stress].some((s) => s.winRate === null || s.winRate < 0.51 || s.meanNetPct === null ||
    s.meanNetPct <= 0 || s.positiveSumPct <= s.negativeSumPct || s.withoutBestDaySumPct <= 0 || s.withoutBestTickerSumPct <= 0))) reasons.push('failed-yearly-economic-or-winrate-gate');
  const oracle = trades.filter((t) => t.oracleNet !== null);
  return { mechanism, status: reasons.length ? 'rejected-in-discovery' : 'requires-independent-test-not-tradeable', reasons,
    combined, bootstrap: blockIntervals(trades), years,
    oracle: { interpretation: 'Future-aware opportunity diagnostic only, NOT a strategy or predictor.', count: oracle.length,
      excludedIncompleteOrDelayed: trades.length - oracle.length,
      netPositiveFraction: oracle.length ? oracle.filter((t) => t.oracleNet! > 0).length / oracle.length : null },
    unresolved, trades };
});
const report = { round: 'mechanism-discovery-v1', protocolSha256,
  codeSha256: digest(Buffer.concat(['src/research-mechanism-discovery.ts', 'src/research/mechanism-discovery.ts',
    'src/research/trading-costs.ts', 'src/research/verified-candles.ts'].map((p) => readFileSync(p)))),
  interpretation: 'Discovery on previously studied history. No independent validation; no trading authorization.',
  testedMechanisms: 3, controls: 1, sources: sources.map(({ data: unused, ...a }) => a), blockedHistory, decisions, reports };
writeFileSync('.trading/mechanism-discovery-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ ...report, decisions: decisions.length, reports: reports.map(({ trades, ...r }) => r) }, null, 2));
