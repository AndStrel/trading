import { readFileSync, writeFileSync } from 'node:fs';
import { digest } from './research/verified-candles.js';
import { simulateWeeklyMarketRegime } from './research/weekly-market-regime.js';
import { relativeStats, simulateWeeklyRelativeStrength } from './research/weekly-relative-strength.js';
import type { DailyBar } from './research/weekly-trend.js';

const protocolSha256 = digest(readFileSync('docs/WEEKLY_MARKET_REGIME_V1.md'));
if (protocolSha256 !== '326d83fc918b6f42e92531b3a187a4ed4805fe262765dcd9816a546a2c443953') {
  throw new Error('Frozen market-regime protocol changed');
}
function source(path: string, expectedHash: string, expectedRows: number) {
  const value = JSON.parse(readFileSync(path, 'utf8')) as { rowsSha256: string; rows: DailyBar[] };
  if (value.rowsSha256 !== expectedHash || value.rows.length !== expectedRows ||
    digest(JSON.stringify(value.rows)) !== expectedHash) throw new Error(`Frozen source changed: ${path}`);
  return value;
}
const sber = source('.trading/sber-daily-2015-2025.json',
  '07fa1ee1facc96812b196a910525238e1257113906d7abc2187a16fc141093ab', 2827);
const gazp = source('.trading/gazp-daily-2015-2025.json',
  'd0705203ae7629cc0b919f5b2a6da8b5be333972d8c81aba8bc6d1b13923c261', 2827);
const imoex = source('.trading/imoex-daily-2015-2025.json',
  'ac3c41fdedaabdf78e64dd48f2d03b08c362bd88453b81a90eb73c483a2e4cc0', 2764);
const result = simulateWeeklyMarketRegime(sber.rows, gazp.rows, imoex.rows);
const control = simulateWeeklyRelativeStrength(sber.rows, gazp.rows);
const groups = [
  { name: '2016-2019', from: 2016, to: 2019 },
  { name: '2020-2022', from: 2020, to: 2022 },
  { name: '2023-2025', from: 2023, to: 2025 },
];
const combined = relativeStats(result.trades);
const periods = groups.map((group) => ({ group: group.name,
  ...relativeStats(result.trades.filter((trade) => {
    const year = Number(trade.entryDay.slice(0, 4));
    return year >= group.from && year <= group.to;
  })) }));
const years = Array.from({ length: 10 }, (_, index) => 2016 + index).map((year) => ({ year,
  ...relativeStats(result.trades.filter((trade) => trade.entryDay.startsWith(String(year)))) }));
const reasons: string[] = [];
if (combined.trades < 100 || combined.weeks < 50) reasons.push('insufficient-sample');
if (combined.winRate === null || combined.winRate < 0.51 || combined.meanNetPct === null ||
  combined.meanNetPct <= 0 || combined.profitFactor === null || combined.profitFactor <= 1 ||
  combined.withoutBestFiveSumPct <= 0) reasons.push('failed-combined-gate');
if (periods.some((period) => period.trades > 0 && (period.winRate === null || period.winRate < 0.51 ||
  period.meanNetPct === null || period.meanNetPct <= 0))) reasons.push('failed-period-gate');
if (years.some((year) => year.trades > 0 && (year.meanNetPct === null || year.meanNetPct <= 0))) {
  reasons.push('failed-year-gate');
}
if (years.some((year) => year.trades === 0)) reasons.push('unobserved-year');
const report = { experiment: 'weekly-market-regime-v1', protocolSha256,
  sourceSha256: { sber: sber.rowsSha256, gazp: gazp.rowsSha256, imoex: imoex.rowsSha256 },
  codeSha256: digest(Buffer.concat(['src/research-weekly-market-regime.ts',
    'src/research/weekly-market-regime.ts', 'src/research/trading-costs.ts'].map((path) => readFileSync(path)))),
  ...result, combined, periods, years,
  status: reasons.length ? 'rejected-in-discovery' : 'requires-independent-test-not-tradeable', reasons,
  control: { combined: relativeStats(control.trades), endingLiquidationValue: control.endingLiquidationValue } };
writeFileSync('.trading/weekly-market-regime-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
const { trades: unusedTrades, decisions: unusedDecisions, pending, ...summary } = report;
console.log(JSON.stringify({ ...summary, tradeCount: report.trades.length,
  decisionCount: report.decisions.length, pendingCount: pending.length }, null, 2));
