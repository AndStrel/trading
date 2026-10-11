import { readFileSync, writeFileSync } from 'node:fs';
import { digest } from './research/verified-candles.js';
import { ownMonthPasses, simulateOwnMonth, type OwnMonthSide, type OwnMonthTrade } from './research/candle-own-month.js';
import type { DailyBar } from './research/weekly-trend.js';

const protocolSha256 = digest(readFileSync('docs/CANDLE_OWN_MONTH_2024_2025_V1.md'));
if (protocolSha256 !== '5311b2451a153c67f85102ae92f667e1d58bb0929ccd19b76216d341b5d3a9fa') throw new Error('Frozen own-month protocol changed');

const files = {
  SBER: ['.trading/sber-daily-2015-2025.json', '07fa1ee1facc96812b196a910525238e1257113906d7abc2187a16fc141093ab'],
  GAZP: ['.trading/gazp-daily-2015-2025.json', 'd0705203ae7629cc0b919f5b2a6da8b5be333972d8c81aba8bc6d1b13923c261'],
  SBMX: ['.trading/sbmx-daily-2021-2025.json', '31e0501946b7e733d35f4138d196d3e191e1513e9ebfa385bce68a87f901f6ed'],
} as const;
const names = ['SBER', 'GAZP', 'SBMX'] as const;

function load(path: string, sha: string): DailyBar[] {
  const source = JSON.parse(readFileSync(path, 'utf8')) as { rowsSha256: string; rows: DailyBar[] };
  if (source.rowsSha256 !== sha) throw new Error(`Frozen source changed: ${path}`);
  return source.rows;
}

const books = Object.fromEntries(names.map((name) => {
  const [path, sha] = files[name];
  return [name, load(path, sha)];
})) as Record<typeof names[number], DailyBar[]>;

function summarize(trades: OwnMonthTrade[]) {
  const mean = (values: number[]) => values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    trades: trades.length,
    winRate: trades.length === 0 ? null : trades.filter((trade) => trade.netPct > 0).length / trades.length,
    meanNetPct: mean(trades.map((trade) => trade.netPct)),
    meanStressPct: mean(trades.map((trade) => trade.stressPct)),
  };
}

function sideReport(side: OwnMonthSide) {
  const byName = Object.fromEntries(names.map((name) => {
    const trades = simulateOwnMonth(books[name], side);
    const discovery = trades.filter((trade) => trade.month.startsWith('2024'));
    const confirmation = trades.filter((trade) => trade.month.startsWith('2025'));
    return [name, { discovery: summarize(discovery), confirmation: summarize(confirmation), discoveryPass: ownMonthPasses(discovery), confirmationPass: ownMonthPasses(confirmation) }];
  }));
  const selected = names.every((name) => byName[name]!.discoveryPass);
  const confirmed = selected && names.every((name) => byName[name]!.confirmationPass);
  return { side, selected, confirmed, byName };
}

const groups = [sideReport('continue'), sideReport('reverse')];
const report = {
  experiment: 'candle-own-month-2024-2025-v1',
  protocolSha256,
  tariff: 'trader-before-subscription',
  profitable: groups.filter((group) => group.confirmed).map((group) => group.side),
  groups,
};
writeFileSync('.trading/candle-own-month-2024-2025-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ profitable: report.profitable, groups: groups.map((group) => ({ side: group.side, selected: group.selected, confirmed: group.confirmed, byName: group.byName })) }, null, 2));
