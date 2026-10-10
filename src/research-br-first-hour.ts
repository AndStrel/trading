import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { br2026DaySpecs, readCachedBrDay } from './research-br-2026-source.js';
import { evaluateBrFirstHour, type BrFirstHourDecision } from './research/br-first-hour.js';

const sourceReportPath = join(process.cwd(), '.trading', 'br-2026-continuous-source.json');
const protocolPath = join(process.cwd(), 'docs', 'BR_FIRST_HOUR_V1.md');
const reportPath = join(process.cwd(), '.trading', 'br-first-hour-v1.json');
const lockedSourceSha256 = 'd8721ce74334619fc1c7f6f960a85d6e77e7ddcb050958163a9b9d8081caf57a';
const specialSessionDates = new Set(['2026-05-01', '2026-06-12']);

function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function summarize(decisions: readonly BrFirstHourDecision[]): Record<string, number | null> {
  const trades = decisions.filter((decision) => decision.status === 'trade');
  const base = trades.map((trade) => trade.baseNet!);
  const positive = base.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const negative = base.filter((value) => value < 0).reduce((sum, value) => sum - value, 0);
  const sum = base.reduce((total, value) => total + value, 0);
  return {
    dates: decisions.length,
    specialSessions: decisions.filter((decision) => decision.status === 'special_session').length,
    noCandles: decisions.filter((decision) => decision.status === 'no_candles').length,
    missingOpening: decisions.filter((decision) => decision.status === 'missing_opening').length,
    cancelledEntry: decisions.filter((decision) => decision.status === 'cancelled_entry').length,
    unresolvedHolding: decisions.filter((decision) => decision.status === 'unresolved_holding').length,
    cash: decisions.filter((decision) => decision.status === 'cash').length,
    signals: decisions.filter((decision) => decision.side !== undefined).length,
    trades: trades.length,
    stops: trades.filter((trade) => trade.exitReason === 'stop').length,
    targets: trades.filter((trade) => trade.exitReason === 'target').length,
    timedExits: trades.filter((trade) => trade.exitReason === 'time').length,
    winners: base.filter((value) => value > 0).length,
    winRate: trades.length ? base.filter((value) => value > 0).length / trades.length : null,
    meanGross: trades.length ? trades.reduce((total, trade) => total + trade.gross!, 0) / trades.length : null,
    meanBaseNet: trades.length ? sum / trades.length : null,
    meanStressNet: trades.length ? trades.reduce((total, trade) => total + trade.stressNet!, 0) / trades.length : null,
    sumBaseNet: sum,
    profitFactor: negative > 0 ? positive / negative : null,
    withoutBestDateSum: trades.length ? sum - Math.max(...base) : null,
  };
}

function main(): void {
  if (process.argv.length !== 2) throw new Error('Offline replay takes no flags');
  if (!existsSync(sourceReportPath) || sha256(readFileSync(sourceReportPath)) !== lockedSourceSha256) {
    throw new Error(`Locked BR source report is missing or changed: ${sourceReportPath}`);
  }
  if (!existsSync(protocolPath)) throw new Error(`Missing fixed protocol ${protocolPath}`);
  const sourceReport = JSON.parse(readFileSync(sourceReportPath, 'utf8')) as { sources: { date: string; contract: string; candleCount: number }[] };
  const specs = br2026DaySpecs();
  if (sourceReport.sources.length !== specs.length) throw new Error('Source date count differs from fixed calendar');
  const decisions: BrFirstHourDecision[] = [];
  for (const [index, spec] of specs.entries()) {
    const source = sourceReport.sources[index];
    if (source?.date !== spec.date || source.contract !== spec.contract) throw new Error(`Source contract/date mismatch at ${spec.date}`);
    const { candles } = readCachedBrDay(spec);
    if (candles.length !== source.candleCount) throw new Error(`Source candle count changed for ${spec.date}`);
    if (specialSessionDates.has(spec.date)) {
      decisions.push({ date: spec.date, contract: spec.contract, status: 'special_session' });
    } else {
      decisions.push(evaluateBrFirstHour(spec.date, spec.contract, candles));
    }
  }
  const combined = summarize(decisions);
  const regular = decisions.filter((decision) => decision.status !== 'special_session');
  const months = [...new Set(regular.map((decision) => decision.date.slice(0, 7)))];
  const byMonth = Object.fromEntries(months.map((month) => [month, summarize(regular.filter((decision) => decision.date.startsWith(month)))]));
  const bySide = Object.fromEntries(['long', 'short'].map((side) => [side, summarize(regular.filter((decision) => decision.side === side))]));
  const blocks = {
    marchMay: summarize(regular.filter((decision) => decision.date < '2026-06-01')),
    juneSeptember: summarize(regular.filter((decision) => decision.date >= '2026-06-01')),
  };
  const bestMonthSum = Math.max(...Object.values(byMonth).map((summary) => summary.sumBaseNet!));
  const withoutBestMonthSum = combined.sumBaseNet! - bestMonthSum;
  const passesGate = combined.trades! >= 100 && combined.signals! >= 50 &&
    combined.noCandles === 0 && combined.missingOpening === 0 &&
    combined.cancelledEntry === 0 && combined.unresolvedHolding === 0 &&
    combined.winRate! >= 0.51 && combined.meanBaseNet! > 0 &&
    combined.meanStressNet! > 0 && combined.profitFactor! > 1 &&
    combined.withoutBestDateSum! > 0 && withoutBestMonthSum > 0 &&
    blocks.marchMay.trades! > 0 && blocks.marchMay.meanBaseNet! > 0 &&
    blocks.juneSeptember.trades! > 0 && blocks.juneSeptember.meanBaseNet! > 0;
  const report = {
    protocolSha256: sha256(readFileSync(protocolPath)),
    sourceReportSha256: lockedSourceSha256,
    source: 'MOEX ISS RFUD cached one-minute BR candles; no broker token',
    status: passesGate ? 'quote-proxy-candidate-for-independent-and-ruble-check-only' : 'failed-or-insufficient-development-gate',
    costs: { commissionPerSide: 0.001, baseSlippagePerSide: 0.0005, stressSlippagePerSide: 0.001 },
    caveat: 'Quote-normalized return, not exact ruble P&L or executable fills',
    combined, byMonth, bySide, blocks, withoutBestMonthSum, decisions,
  };
  const temporary = `${reportPath}.part`;
  writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, reportPath);
  console.log(JSON.stringify({ status: report.status, combined, blocks, withoutBestMonthSum, reportPath }));
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  try { main(); } catch (error) {
    console.error(`BR first-hour research failed: ${error instanceof Error ? error.message : 'unknown failure'}`);
    process.exitCode = 1;
  }
}
