import { readFileSync, writeFileSync } from 'node:fs';
import { digest } from './research/verified-candles.js';
import { monthPasses, simulateMonthLeadership, type MonthSide, type MonthTrade } from './research/candle-month.js';
import type { DailyBar } from './research/weekly-trend.js';

const protocolSha256 = digest(readFileSync('docs/CANDLE_MONTH_2024_2025_V1.md'));
if (protocolSha256 !== '84a070a7710b69218abe7fb241df31cd0c5dfe4b265949236d0db3dae01e323d') throw new Error('Frozen month protocol changed');

const files = {
  SBER: ['.trading/sber-daily-2015-2025.json', '07fa1ee1facc96812b196a910525238e1257113906d7abc2187a16fc141093ab'],
  GAZP: ['.trading/gazp-daily-2015-2025.json', 'd0705203ae7629cc0b919f5b2a6da8b5be333972d8c81aba8bc6d1b13923c261'],
  SBMX: ['.trading/sbmx-daily-2021-2025.json', '31e0501946b7e733d35f4138d196d3e191e1513e9ebfa385bce68a87f901f6ed'],
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
  return {
    side,
    selected,
    confirmed: selected && monthPasses(confirmation),
    discovery: summarize(discovery),
    confirmation: summarize(confirmation),
  };
}

const groups = [sideReport('leader'), sideReport('laggard')];
const report = {
  experiment: 'candle-month-2024-2025-v1',
  protocolSha256,
  tariff: 'trader-before-subscription',
  profitable: groups.filter((group) => group.confirmed).map((group) => group.side),
  groups,
};
writeFileSync('.trading/candle-month-2024-2025-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
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
