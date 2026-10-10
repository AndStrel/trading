import { readFileSync, writeFileSync } from 'node:fs';
import { costScenarios, eventReturnPct } from './research/trading-costs.js';
import { digest, loadVerifiedCandles } from './research/verified-candles.js';
import { weeklyTrendStats, type TrendTrade } from './research/weekly-trend.js';

const protocolSha256 = digest(readFileSync('docs/WEEKLY_TREND_MINUTE_CHECK.md'));
if (protocolSha256 !== '9a3e235918d8bc13e4031b7d8e2d9b7a7c0229cc8d2300c110627789f95498fd') {
  throw new Error('Frozen minute-check protocol changed');
}
const originalBytes = readFileSync('.trading/weekly-trend-v1.json');
const original = JSON.parse(originalBytes.toString()) as {
  protocolSha256: string; sourceSha256: string;
  comparisons: { mode: 'trend' | 'always-long'; trades: TrendTrade[] }[];
};
if (original.protocolSha256 !== 'd8d9419e3647e415f52712f326bf6c37c5df5f821793468c3c0bcebd88343ba7' ||
  original.sourceSha256 !== '07fa1ee1facc96812b196a910525238e1257113906d7abc2187a16fc141093ab') {
  throw new Error('Unexpected original experiment');
}
const sources = loadVerifiedCandles().filter((s) => s.ticker === 'SBER');
const exactOpen = new Map(sources.flatMap((source) => source.data)
  .filter((candle) => candle.time.slice(11, 16) === '07:05')
  .map((candle) => [candle.time, candle.open]));
const comparisons = original.comparisons.map((comparison) => {
  const paired: { original: TrendTrade; minute: TrendTrade; netDifferencePct: number }[] = [];
  const missing: { entryDay: string; exitDay: string; missingAt: string[] }[] = [];
  for (const trade of comparison.trades.filter((t) => t.entryDay >= '2023-01-01')) {
    const entryTime = `${trade.entryDay}T07:05:00.000Z`, exitTime = `${trade.exitDay}T07:05:00.000Z`;
    const entry = exactOpen.get(entryTime), exit = exactOpen.get(exitTime);
    if (entry === undefined || exit === undefined) {
      missing.push({ entryDay: trade.entryDay, exitDay: trade.exitDay,
        missingAt: [entry === undefined ? entryTime : '', exit === undefined ? exitTime : ''].filter(Boolean) });
      continue;
    }
    const netPct = eventReturnPct(entry, exit, costScenarios.investorBase);
    paired.push({ original: trade, minute: { ...trade, entry, exit, netPct,
      grossPct: eventReturnPct(entry, exit, costScenarios.gross),
      stressPct: eventReturnPct(entry, exit, costScenarios.investorStress),
      proceeds: trade.principal * (1 + netPct / 100) },
    netDifferencePct: netPct - trade.netPct });
  }
  const minuteTrades = paired.map((p) => p.minute), originalPaired = paired.map((p) => p.original);
  const meanAbsDifferencePct = paired.length ? paired.reduce((sum, p) => sum + Math.abs(p.netDifferencePct), 0) / paired.length : null;
  return { mode: comparison.mode, pairedCount: paired.length, missingCount: missing.length, missing,
    originalPaired: weeklyTrendStats(originalPaired), minute: weeklyTrendStats(minuteTrades),
    years: [2023, 2024, 2025].map((year) => ({ year,
      originalPaired: weeklyTrendStats(originalPaired.filter((t) => t.entryDay.startsWith(String(year)))),
      minute: weeklyTrendStats(minuteTrades.filter((t) => t.entryDay.startsWith(String(year)))) })),
    meanAbsDifferencePct, changedWinClassification: paired.filter((p) => (p.original.netPct > 0) !== (p.minute.netPct > 0)).length,
    paired };
});
const report = { check: 'weekly-trend-minute-execution', protocolSha256,
  originalReportSha256: digest(originalBytes), sources: sources.map(({ data: unused, ...source }) => source), comparisons };
writeFileSync('.trading/weekly-trend-minute-check.json', JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ ...report, comparisons: comparisons.map(({ paired, missing, ...rest }) => ({
  ...rest, paired: paired.length, missing: missing.length })) }, null, 2));
