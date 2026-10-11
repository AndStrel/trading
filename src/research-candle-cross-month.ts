import { readFileSync, writeFileSync } from 'node:fs';
import { digest } from './research/verified-candles.js';
import { crossGroupPasses, simulateCrossMonth, type CrossTrade } from './research/candle-cross-month.js';
import type { DailyBar } from './research/weekly-trend.js';

const protocolSha256 = digest(readFileSync('docs/CANDLE_CROSS_MONTH_2024_2025_V1.md'));
if (protocolSha256 !== '914a824ba27616cfa8f54b57cd887ec3e2845c48d6439b7831a4f2b4cf31c8a3') throw new Error('Frozen cross-month protocol changed');

const files = {
  TGLD: ['.trading/tgld-daily-2022-2025.json', '347575ab305338bcc9408be815366a5c12f37b164c10a5e08bf024a5e653ca2f'],
  SBGB: ['.trading/sbgb-daily-2021-2025.json', '0fbfae6a340f6c58e4f9b3132d005fe99d3f63969909d5a1eed5de1cc2ca56f4'],
  SBMX: ['.trading/sbmx-daily-2021-2025.json', '31e0501946b7e733d35f4138d196d3e191e1513e9ebfa385bce68a87f901f6ed'],
} as const;

function load(path: string, sha: string): DailyBar[] {
  const source = JSON.parse(readFileSync(path, 'utf8')) as { rowsSha256: string; rows: DailyBar[] };
  if (source.rowsSha256 !== sha) throw new Error(`Frozen source changed: ${path}`);
  return source.rows;
}

const books = Object.fromEntries(Object.entries(files).map(([name, [path, sha]]) => [name, load(path, sha)])) as Record<keyof typeof files, DailyBar[]>;
const trades = [...simulateCrossMonth(books.TGLD, books.SBMX, 'tgld'), ...simulateCrossMonth(books.SBGB, books.SBMX, 'sbgb')];
const patterns = ['tgld-up', 'tgld-down', 'sbgb-up', 'sbgb-down'];

function summarize(sample: CrossTrade[]) {
  const mean = (values: number[]) => values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    trades: sample.length,
    winRate: sample.length === 0 ? null : sample.filter((trade) => trade.netPct > 0).length / sample.length,
    meanNetPct: mean(sample.map((trade) => trade.netPct)),
    meanStressPct: mean(sample.map((trade) => trade.stressPct)),
  };
}

const groups = patterns.map((pattern) => {
  const discovery = trades.filter((trade) => trade.pattern === pattern && trade.month.startsWith('2024'));
  const confirmation = trades.filter((trade) => trade.pattern === pattern && trade.month.startsWith('2025'));
  const selected = crossGroupPasses(discovery);
  return { pattern, selected, confirmed: selected && crossGroupPasses(confirmation), discovery: summarize(discovery), confirmation: summarize(confirmation) };
});
const report = {
  experiment: 'candle-cross-month-2024-2025-v1',
  protocolSha256,
  tariff: 'trader-before-subscription',
  profitable: groups.filter((group) => group.confirmed).map((group) => group.pattern),
  groups,
};
writeFileSync('.trading/candle-cross-month-2024-2025-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ profitable: report.profitable, groups: groups.map(({ confirmation, ...group }) => group) }, null, 2));
