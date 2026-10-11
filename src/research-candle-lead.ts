import { readFileSync, writeFileSync } from 'node:fs';
import { digest } from './research/verified-candles.js';
import { leadGroupPasses, simulateLead, type LeadTrade } from './research/candle-lead.js';
import type { DailyBar } from './research/weekly-trend.js';

const protocolSha256 = digest(readFileSync('docs/CANDLE_LEAD_2024_2025_V1.md'));
if (protocolSha256 !== '3ec21c5a88a19de5f014f533d23e86ff6ff9271a5dd3bd0b1adac087bfea30fe') throw new Error('Frozen lead protocol changed');

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

const sber = load(files.SBER[0], files.SBER[1]);
const gazp = load(files.GAZP[0], files.GAZP[1]);
const sbmx = load(files.SBMX[0], files.SBMX[1]);
const trades = simulateLead(sber, gazp, sbmx);

function summarize(sample: LeadTrade[]) {
  const mean = (values: number[]) => values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    trades: sample.length,
    winRate: sample.length === 0 ? null : sample.filter((trade) => trade.netPct > 0).length / sample.length,
    meanNetPct: mean(sample.map((trade) => trade.netPct)),
    meanStressPct: mean(sample.map((trade) => trade.stressPct)),
  };
}

const groups = (['S', 'G'] as const).map((pattern) => {
  const discovery = trades.filter((trade) => trade.pattern === pattern && trade.day.startsWith('2024'));
  const confirmation = trades.filter((trade) => trade.pattern === pattern && trade.day.startsWith('2025'));
  const selected = leadGroupPasses(discovery, false);
  return { pattern, selected, confirmed: selected && leadGroupPasses(confirmation, true), discovery: summarize(discovery), confirmation: summarize(confirmation) };
});
const report = {
  experiment: 'candle-lead-2024-2025-v1',
  protocolSha256,
  tariff: 'trader-before-subscription',
  profitable: groups.filter((group) => group.confirmed).map((group) => group.pattern),
  groups,
};
writeFileSync('.trading/candle-lead-2024-2025-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ profitable: report.profitable, groups: groups.map(({ confirmation, ...group }) => group) }, null, 2));
