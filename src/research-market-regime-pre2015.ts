import { readFileSync, writeFileSync } from 'node:fs';
import { pre2015IndexGapScenarios } from './research/index-gap-scenarios.js';
import { relativeStats } from './research/weekly-relative-strength.js';
import { simulateWeeklyMarketRegime } from './research/weekly-market-regime.js';
import { auditWeeklyPortfolio } from './research/weekly-portfolio-risk.js';
import { digest } from './research/verified-candles.js';
import type { DailyBar } from './research/weekly-trend.js';

const documents = [
  ['docs/WEEKLY_MARKET_REGIME_PRE2015_VALIDATION.md',
    '87f915d53dc28edcc9d3d67b7feb50b309850c15ce829e2475971271a90527cd'],
  ['docs/WEEKLY_MARKET_REGIME_PRE2015_AMENDMENT.md',
    '71da5229fb17ddcfa6b040fc90d584612a5abcf4f7132fb6d5a345364a83735e'],
  ['docs/WEEKLY_MARKET_REGIME_PRE2015_INDEX_GAP.md',
    'a50440f5f6ea704875d042748b495f03dd5845ae4cf70465cd4ac80486ffc59b'],
] as const;
for (const [path, expected] of documents) {
  if (digest(readFileSync(path)) !== expected) throw new Error(`Frozen document changed: ${path}`);
}
function source(path: string, expectedHash: string, expectedRows: number) {
  const value = JSON.parse(readFileSync(path, 'utf8')) as { rowsSha256: string; rows: DailyBar[];
    coverage: { year: number; count: number; first: string | null; last: string | null }[] };
  if (value.rowsSha256 !== expectedHash || value.rows.length !== expectedRows ||
    value.coverage.length !== 8 || digest(JSON.stringify(value.rows)) !== expectedHash) {
    throw new Error(`Frozen historical source changed: ${path}`);
  }
  return value;
}
const sber = source('.trading/sber-daily-2007-2014.json',
  '48ea2a587bf5c275c74799a190d9fa8297b74b029bedababbc874994a7a7611f', 1862);
const gazp = source('.trading/gazp-daily-2007-2014.json',
  'f77beddbc27bc348a8e0eaf8ba3e7fb0f18ad9adb769cca6ce447de4a2386d61', 1995);
const imoex = source('.trading/imoex-daily-2007-2014.json',
  'fb3804b5957940cd37a4954be30f7cf12fb7648e4edef531c4ef46d12d689530', 1998);
const gaps = pre2015IndexGapScenarios(sber.rows, gazp.rows, imoex.rows);
const scenarios = (['carry-forward', 'omit-day'] as const).map((name) => {
  const input = name === 'carry-forward' ? gaps.carryForward : gaps.omitDay;
  const result = simulateWeeklyMarketRegime(input.sber, input.gazp, input.imoex);
  const portfolio = auditWeeklyPortfolio(input.sber, result.trades, result.pending, result.endingCash);
  const combined = relativeStats(result.trades);
  const years = Array.from({ length: 7 }, (_, index) => 2008 + index).map((year) => ({ year,
    partial: year === 2008,
    ...relativeStats(result.trades.filter((trade) => trade.entryDay.startsWith(String(year)))) }));
  const reasons: string[] = [];
  if (combined.trades < 100 || combined.weeks < 50) reasons.push('insufficient-sample');
  if (combined.winRate === null || combined.winRate < 0.51 || combined.meanNetPct === null ||
    combined.meanNetPct <= 0 || combined.profitFactor === null || combined.profitFactor <= 1 ||
    combined.withoutBestFiveSumPct <= 0) reasons.push('failed-combined-gate');
  if (years.some((year) => year.trades > 0 && (year.meanNetPct === null || year.meanNetPct <= 0))) {
    reasons.push('failed-year-gate');
  }
  if (years.some((year) => year.trades === 0)) reasons.push('unobserved-year');
  return { name, sourceRows: { sber: input.sber.length, gazp: input.gazp.length,
    imoex: input.imoex.length }, imputedDay: name === 'carry-forward' ? gaps.carryForward.imputedDay : null,
  firstEligibleDay: result.decisions.find((decision) => decision.status !== 'warmup')?.day ?? null,
  ...result, combined, years, portfolio,
  status: reasons.length ? 'failed-independent-history' : 'passed-historical-gates-needs-prospective-test', reasons };
});
const report = { experiment: 'weekly-market-regime-pre2015-validation',
  documentSha256: Object.fromEntries(documents.map(([path, hash]) => [path, hash])),
  sourceSha256: { sber: sber.rowsSha256, gazp: gazp.rowsSha256, imoex: imoex.rowsSha256 },
  codeSha256: digest(Buffer.concat(['src/research-market-regime-pre2015.ts',
    'src/research/index-gap-scenarios.ts', 'src/research/weekly-market-regime.ts',
    'src/research/weekly-portfolio-risk.ts'].map((path) => readFileSync(path)))),
  sourceCoverage: { sber: sber.coverage, gazp: gazp.coverage, imoex: imoex.coverage },
  consensusPassed: scenarios.every((scenario) => scenario.reasons.length === 0), scenarios };
writeFileSync('.trading/weekly-market-regime-pre2015-validation.json', JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ ...report, scenarios: scenarios.map(({ trades, decisions, pending, portfolio, ...summary }) => ({
  ...summary, tradeCount: trades.length, decisionCount: decisions.length, pendingCount: pending.length,
  portfolio: { endingCash: portfolio.endingCash,
    endingCloseLiquidationValue: portfolio.endingCloseLiquidationValue,
    activeWeeks: portfolio.activeWeeks, positiveActiveWeeks: portfolio.positiveActiveWeeks,
    activeWeekWinRate: portfolio.activeWeekWinRate, maxDrawdownPct: portfolio.maxDrawdownPct,
    drawdownPeakDay: portfolio.drawdownPeakDay, troughDay: portfolio.troughDay } })) }, null, 2));
