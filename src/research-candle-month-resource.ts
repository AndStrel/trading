import { readFileSync, writeFileSync } from 'node:fs';
import { digest } from './research/verified-candles.js';
import { monthPasses, simulateMonthLeadership, type MonthSide, type MonthTrade } from './research/candle-month.js';
import type { DailyBar } from './research/weekly-trend.js';

const protocolSha256 = digest(readFileSync('docs/CANDLE_MONTH_RESOURCE_2024_2025_V1.md'));
if (protocolSha256 !== '01d4626d71e4f4ca109fda0c36fae1a91c5dcb167ef7831ac7456e96012f3d94') throw new Error('Frozen resource-month protocol changed');

const files = {
  LKOH: ['.trading/lkoh-daily-2021-2025.json', 'c6ac11b117d326a4272da5349d0f6778146af80840d63686e18889d4f96f512a'],
  ROSN: ['.trading/rosn-daily-2021-2025.json', '68f0731e9cf77b4add121411753e2d6805f081a8dec6b8d157cb865e1d274d06'],
  PLZL: ['.trading/plzl-daily-2022-2025.json', '001bec15575548ca470b5ae3c4e529d6990583f3fc9426fb9369626422483d4c'],
} as const;

function load(path: string, sha: string): DailyBar[] {
  const source = JSON.parse(readFileSync(path, 'utf8')) as { rowsSha256: string; rows: DailyBar[] };
  if (source.rowsSha256 !== sha) throw new Error(`Frozen source changed: ${path}`);
  return source.rows;
}

const books = Object.fromEntries(Object.entries(files).map(([name, [path, sha]]) => [name, load(path, sha)])) as Record<string, DailyBar[]>;

function summarize(trades: MonthTrade[]) {
  const mean = (values: number[]) => values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    trades: trades.length,
    winRate: trades.length === 0 ? null : trades.filter((trade) => trade.netPct > 0).length / trades.length,
    meanNetPct: mean(trades.map((trade) => trade.netPct)),
    meanStressPct: mean(trades.map((trade) => trade.stressPct)),
    months: trades.map((trade) => ({ month: trade.month, ticker: trade.ticker, netPct: trade.netPct })),
  };
}

function sideReport(side: MonthSide) {
  const trades = simulateMonthLeadership(books, side);
  const discovery = trades.filter((trade) => trade.month.startsWith('2024'));
  const confirmation = trades.filter((trade) => trade.month.startsWith('2025'));
  const selected = monthPasses(discovery);
  return { side, selected, confirmed: selected && monthPasses(confirmation), discovery: summarize(discovery), confirmation: summarize(confirmation) };
}

const groups = [sideReport('leader'), sideReport('laggard')];
const report = {
  experiment: 'candle-month-resource-2024-2025-v1',
  protocolSha256,
  tariff: 'trader-before-subscription',
  profitable: groups.filter((group) => group.confirmed).map((group) => group.side),
  groups,
};
writeFileSync('.trading/candle-month-resource-2024-2025-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({
  profitable: report.profitable,
  groups: groups.map((group) => ({
    side: group.side,
    selected: group.selected,
    confirmed: group.confirmed,
    discovery: { trades: group.discovery.trades, winRate: group.discovery.winRate, meanNetPct: group.discovery.meanNetPct, meanStressPct: group.discovery.meanStressPct },
    confirmation: { trades: group.confirmation.trades, winRate: group.confirmation.winRate, meanNetPct: group.confirmation.meanNetPct, meanStressPct: group.confirmation.meanStressPct },
  })),
}, null, 2));
