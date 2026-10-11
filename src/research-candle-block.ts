import { readFileSync, writeFileSync } from 'node:fs';
import { digest } from './research/verified-candles.js';
import { blockGroupPasses, simulateBlocks, type BlockTrade } from './research/candle-block.js';
import type { DailyBar } from './research/weekly-trend.js';

const protocolSha256 = digest(readFileSync('docs/CANDLE_BLOCK_2024_2025_V1.md'));
if (protocolSha256 !== 'b4e181321f092de8023c52deaa7fa819771a0dd3052ca340e9b901e2e2e3898d') throw new Error('Frozen block protocol changed');

const files = {
  IMOEX: ['.trading/imoex-daily-2015-2025.json', 'ac3c41fdedaabdf78e64dd48f2d03b08c362bd88453b81a90eb73c483a2e4cc0'],
  SBMX: ['.trading/sbmx-daily-2021-2025.json', '31e0501946b7e733d35f4138d196d3e191e1513e9ebfa385bce68a87f901f6ed'],
} as const;

function load(path: string, sha: string): DailyBar[] {
  const source = JSON.parse(readFileSync(path, 'utf8')) as { rowsSha256: string; rows: DailyBar[] };
  if (source.rowsSha256 !== sha) throw new Error(`Frozen source changed: ${path}`);
  return source.rows;
}

const imoex = load(files.IMOEX[0], files.IMOEX[1]);
const sbmx = load(files.SBMX[0], files.SBMX[1]);
const trades = [...simulateBlocks(imoex, sbmx, 'imoex'), ...simulateBlocks(sbmx, sbmx, 'sbmx')];
const patterns = ['imoex-U', 'imoex-D', 'sbmx-U', 'sbmx-D'];

function summarize(sample: BlockTrade[]) {
  const mean = (values: number[]) => values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    trades: sample.length,
    winRate: sample.length === 0 ? null : sample.filter((trade) => trade.netPct > 0).length / sample.length,
    meanNetPct: mean(sample.map((trade) => trade.netPct)),
    meanStressPct: mean(sample.map((trade) => trade.stressPct)),
  };
}

const groups = patterns.map((pattern) => {
  const discovery = trades.filter((trade) => trade.pattern === pattern && trade.day.startsWith('2024'));
  const confirmation = trades.filter((trade) => trade.pattern === pattern && trade.day.startsWith('2025'));
  const selected = blockGroupPasses(discovery, false);
  return { pattern, selected, confirmed: selected && blockGroupPasses(confirmation, true), discovery: summarize(discovery), confirmation: summarize(confirmation) };
});
const report = {
  experiment: 'candle-block-2024-2025-v1',
  protocolSha256,
  imoexSourceSha256: files.IMOEX[1],
  tariff: 'trader-before-subscription',
  profitable: groups.filter((group) => group.confirmed).map((group) => group.pattern),
  groups,
};
writeFileSync('.trading/candle-block-2024-2025-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ profitable: report.profitable, groups: groups.map(({ confirmation, ...group }) => group) }, null, 2));
