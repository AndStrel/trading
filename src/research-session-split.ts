import { readFileSync, writeFileSync } from 'node:fs';
import { digest } from './research/verified-candles.js';
import { sessionGateReasons, simulateSessionSplit, type SessionKind } from './research/session-split.js';
import type { DailyBar } from './research/weekly-trend.js';

const protocolSha256 = digest(readFileSync('docs/SESSION_SPLIT_TRADER_V1.md'));
if (protocolSha256 !== '6ab96c1ba366ae0260c11853d86c479354f32789e1e78acd83bcc1df2896a538') throw new Error('Frozen session-split protocol changed');

const files = {
  SBER: ['.trading/sber-daily-2015-2025.json', '07fa1ee1facc96812b196a910525238e1257113906d7abc2187a16fc141093ab'],
  GAZP: ['.trading/gazp-daily-2015-2025.json', 'd0705203ae7629cc0b919f5b2a6da8b5be333972d8c81aba8bc6d1b13923c261'],
  SBMX: ['.trading/sbmx-daily-2021-2025.json', '31e0501946b7e733d35f4138d196d3e191e1513e9ebfa385bce68a87f901f6ed'],
} as const;
const kinds: SessionKind[] = ['overnight', 'cash-session', 'five-session'];

function load(path: string, sha: string): DailyBar[] {
  const source = JSON.parse(readFileSync(path, 'utf8')) as { rowsSha256: string; rows: DailyBar[] };
  if (source.rowsSha256 !== sha) throw new Error(`Frozen source changed: ${path}`);
  return source.rows;
}

const names = Object.fromEntries(Object.entries(files).map(([name, [path, sha]]) => [name, load(path, sha)])) as Record<keyof typeof files, DailyBar[]>;

function summarize(kind: SessionKind, rows: DailyBar[]) {
  const trades = simulateSessionSplit(rows, kind);
  const mean = (year?: number) => {
    const sample = year === undefined ? trades : trades.filter((trade) => trade.day.startsWith(String(year)));
    return sample.length === 0 ? null : sample.reduce((sum, trade) => sum + trade.netPct, 0) / sample.length;
  };
  const minTrades = kind === 'five-session' ? 100 : 500;
  return {
    trades: trades.length,
    winRate: trades.length === 0 ? null : trades.filter((trade) => trade.netPct > 0).length / trades.length,
    meanNetPct: mean(),
    meanStressPct: trades.length === 0 ? null : trades.reduce((sum, trade) => sum + trade.stressPct, 0) / trades.length,
    mean2022: mean(2022),
    mean2023: mean(2023),
    mean2024: mean(2024),
    mean2025: mean(2025),
    reasons: sessionGateReasons(trades, minTrades),
  };
}

const rules = kinds.map((kind) => {
  const byName = Object.fromEntries(Object.entries(names).map(([name, rows]) => [name, summarize(kind, rows)]));
  const admitted = Object.values(byName).every((item) => item.reasons.length === 0);
  return { kind, byName, status: admitted ? 'not-tradeable-pending-audit' : 'not-admitted' };
});
const report = { experiment: 'session-split-trader-v1', protocolSha256, tariff: 'trader-before-subscription', rules };
writeFileSync('.trading/session-split-trader-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify(report, null, 2));
