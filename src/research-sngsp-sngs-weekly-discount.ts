import { readFileSync, writeFileSync } from 'node:fs';
import { auditWeeklyPortfolio } from './research/weekly-portfolio-risk.js';
import { relativeStats } from './research/weekly-relative-strength.js';
import { simulateWeeklySberpDiscount } from './research/weekly-sberp-discount.js';
import { digest } from './research/verified-candles.js';
import { simulateWeeklyTrend, weeklyTrendStats, type DailyBar } from './research/weekly-trend.js';
import { buyAndHoldLqdt } from './research/weekly-lqdt-carry.js';

const protocolSha256 = digest(readFileSync('docs/SNGSP_SNGS_WEEKLY_DISCOUNT_V1.md'));
if (protocolSha256 !== 'd4583158b8caca3b4304a6fbf87f2d998809103c27043f95bd9b9894945402f1') {
  throw new Error('Frozen SNGSP/SNGS weekly-discount protocol changed');
}

function source(path: string, expected: string) {
  const value = JSON.parse(readFileSync(path, 'utf8')) as {
    rowsSha256: string;
    rows: DailyBar[];
    coverage: { year: number; count: number }[];
  };
  if (value.rowsSha256 !== expected || digest(JSON.stringify(value.rows)) !== expected) {
    throw new Error(`Frozen source changed: ${path}`);
  }
  if (value.coverage.some((year) => year.count < 150 || year.count > 400)) {
    throw new Error(`Coverage outside 150-400: ${path}`);
  }
  return value;
}

const sngs = source('.trading/sngs-daily-2015-2025.json',
  '58c3ab8293cc50966e2fb95243e74a6a219bc177449150c8067c13f33f9a9418');
const sngsp = source('.trading/sngsp-daily-2015-2025.json',
  'bca856ce5d4b266bf03acfd4e324d601ec983ef8b1e0cef8ea696e5e53c2e07a');
const sbmm = JSON.parse(readFileSync('.trading/sbmm-daily-2021-2025.json', 'utf8')) as {
  rowsSha256: string;
  rows: DailyBar[];
};
if (sbmm.rowsSha256 !== '6a70207aa52c48b620597cacadaab117de9d858711a1fae5047f2f075b88eca3') {
  throw new Error('Frozen SBMM source changed');
}
if (sngs.rows.length !== sngsp.rows.length ||
  sngs.rows.some((bar, index) => bar.day !== sngsp.rows[index]?.day)) {
  throw new Error('SNGS and SNGSP calendars differ');
}

const result = simulateWeeklySberpDiscount(sngs.rows, sngsp.rows);
const from2023 = simulateWeeklySberpDiscount(sngs.rows, sngsp.rows, '2023-01-01');
const portfolio = auditWeeklyPortfolio(sngsp.rows, result.trades, result.pending, result.endingCash);
const groups = [
  { name: '2016-2019', from: 2016, to: 2019 },
  { name: '2020-2022', from: 2020, to: 2022 },
  { name: '2023-2025', from: 2023, to: 2025 },
];
const combined = relativeStats(result.trades);
const periods = groups.map((group) => ({
  group: group.name,
  ...relativeStats(result.trades.filter((trade) => {
    const year = Number(trade.entryDay.slice(0, 4));
    return year >= group.from && year <= group.to;
  })),
}));
const years = Array.from({ length: 10 }, (_, index) => 2016 + index).map((year) => ({
  year,
  ...relativeStats(result.trades.filter((trade) => trade.entryDay.startsWith(String(year)))),
}));
const reasons: string[] = [];
if (combined.trades < 100 || combined.weeks < 50) reasons.push('insufficient-sample');
if (combined.winRate === null || combined.winRate < 0.51 || combined.meanNetPct === null ||
  combined.meanNetPct <= 0 || combined.profitFactor === null || combined.profitFactor <= 1 ||
  combined.withoutBestFiveSumPct <= 0 || portfolio.activeWeekWinRate === null ||
  portfolio.activeWeekWinRate < 0.51) reasons.push('failed-combined-gate');
if (periods.some((period) => period.trades > 0 && (period.winRate === null || period.winRate < 0.51 ||
  period.meanNetPct === null || period.meanNetPct <= 0))) reasons.push('failed-period-gate');
if (years.some((year) => year.trades > 0 && (year.meanNetPct === null || year.meanNetPct <= 0))) {
  reasons.push('failed-year-gate');
}
if (years.some((year) => year.trades === 0)) reasons.push('unobserved-year');
const control = simulateWeeklyTrend(sngsp.rows, 'always-long');
const controlPortfolio = auditWeeklyPortfolio(sngsp.rows, control.trades, control.pending, control.endingCash);
if (result.endingLiquidationValue <= control.endingLiquidationValue) {
  reasons.push('inferior-to-always-long-sngsp');
}
const sbmmHold = buyAndHoldLqdt(sbmm.rows, '2023-01-01', '2025-12-31');
if (from2023.endingLiquidationValue <= sbmmHold.endingLiquidationValue) {
  reasons.push('inferior-to-sbmm-cash-sleeve-2023-2025');
}
const sngspHold = buyAndHoldLqdt(sngsp.rows, '2016-01-01', '2025-12-31');
if (result.endingLiquidationValue <= sngspHold.endingLiquidationValue) {
  reasons.push('inferior-to-sngsp-buy-and-hold');
}
const report = {
  experiment: 'sngsp-sngs-weekly-discount-v1',
  protocolSha256,
  sourceSha256: { sngs: sngs.rowsSha256, sngsp: sngsp.rowsSha256, sbmm: sbmm.rowsSha256 },
  ...result,
  combined,
  periods,
  years,
  portfolio,
  from2023Ending: from2023.endingLiquidationValue,
  sbmmHold2023: sbmmHold.endingLiquidationValue,
  sngspBuyAndHold: sngspHold.endingLiquidationValue,
  status: reasons.length ? 'rejected-in-discovery' : 'requires-independent-test-not-tradeable',
  reasons,
  control: {
    combined: weeklyTrendStats(control.trades),
    endingLiquidationValue: control.endingLiquidationValue,
    maxDrawdownPct: controlPortfolio.maxDrawdownPct,
    activeWeekWinRate: controlPortfolio.activeWeekWinRate,
  },
};
writeFileSync('.trading/sngsp-sngs-weekly-discount-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
const { trades: _t, decisions: _d, pending, portfolio: detailedPortfolio, ...summary } = report;
console.log(JSON.stringify({
  ...summary,
  tradeCount: result.trades.length,
  pendingCount: pending.length,
  portfolio: {
    activeWeeks: detailedPortfolio.activeWeeks,
    positiveActiveWeeks: detailedPortfolio.positiveActiveWeeks,
    activeWeekWinRate: detailedPortfolio.activeWeekWinRate,
    maxDrawdownPct: detailedPortfolio.maxDrawdownPct,
  },
}, null, 2));
