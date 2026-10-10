import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { br2026DaySpecs, readCachedBrDay } from './research-br-2026-source.js';
import { readCachedSi2026Day, si2026DaySpecs } from './research-si-2026-source.js';
import { evaluateSiFromBrentLead, type SiFromBrentDecision } from './research/si-from-brent-lead.js';

const siSourcePath = join(process.cwd(), '.trading', 'si-2026-continuous-source.json');
const brSourcePath = join(process.cwd(), '.trading', 'br-2026-continuous-source.json');
const protocolPath = join(process.cwd(), 'docs', 'SI_FROM_BRENT_LEAD_V1.md');
const reportPath = join(process.cwd(), '.trading', 'si-from-brent-lead-v1.json');
const lockedSiSha256 = 'ed8c32be0f099e8caeb8d773b6edaa7cac08e397c326fe2135ba810e56c36b74';
const lockedBrSha256 = 'd8721ce74334619fc1c7f6f960a85d6e77e7ddcb050958163a9b9d8081caf57a';
const specialSessionDates = new Set(['2026-05-01', '2026-06-12']);

function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function summarize(decisions: readonly SiFromBrentDecision[]): Record<string, number | null> {
  const trades = decisions.filter((decision) => decision.status === 'trade');
  const values = trades.map((trade) => trade.baseNet!);
  const positive = values.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const negative = values.filter((value) => value < 0).reduce((sum, value) => sum - value, 0);
  const sum = values.reduce((total, value) => total + value, 0);
  return {
    dates: decisions.length,
    specialSessions: decisions.filter((decision) => decision.status === 'special_session').length,
    missingBrHistory: decisions.filter((decision) => decision.status === 'missing_br_history').length,
    cancelledEntry: decisions.filter((decision) => decision.status === 'cancelled_entry').length,
    unresolvedHolding: decisions.filter((decision) => decision.status === 'unresolved_holding').length,
    cash: decisions.filter((decision) => decision.status === 'cash').length,
    signals: decisions.filter((decision) => decision.side !== undefined).length,
    trades: trades.length,
    stops: trades.filter((trade) => trade.exitReason === 'stop').length,
    targets: trades.filter((trade) => trade.exitReason === 'target').length,
    timedExits: trades.filter((trade) => trade.exitReason === 'time').length,
    winners: values.filter((value) => value > 0).length,
    winRate: trades.length ? values.filter((value) => value > 0).length / trades.length : null,
    meanGross: trades.length ? trades.reduce((total, trade) => total + trade.gross!, 0) / trades.length : null,
    meanBaseNet: trades.length ? sum / trades.length : null,
    meanStressNet: trades.length ? trades.reduce((total, trade) => total + trade.stressNet!, 0) / trades.length : null,
    sumBaseNet: sum,
    profitFactor: negative > 0 ? positive / negative : null,
    withoutBestDateSum: trades.length ? sum - Math.max(...values) : null,
  };
}

function main(): void {
  if (process.argv.length !== 2) throw new Error('Offline replay takes no flags');
  const lockedSources: Array<readonly [string, string]> = [[siSourcePath, lockedSiSha256], [brSourcePath, lockedBrSha256]];
  for (const [path, expected] of lockedSources) {
    if (!existsSync(path) || sha256(readFileSync(path)) !== expected) throw new Error(`Locked source report missing or changed: ${path}`);
  }
  if (!existsSync(protocolPath)) throw new Error(`Missing fixed protocol ${protocolPath}`);
  const siSpecs = si2026DaySpecs();
  const brSpecs = br2026DaySpecs();
  if (siSpecs.length !== brSpecs.length) throw new Error('Source calendars have different lengths');
  const decisions: SiFromBrentDecision[] = [];
  for (const [index, siSpec] of siSpecs.entries()) {
    const brSpec = brSpecs[index];
    if (!brSpec || brSpec.date !== siSpec.date) throw new Error(`Source dates differ at ${siSpec.date}`);
    if (specialSessionDates.has(siSpec.date)) {
      decisions.push({ date: siSpec.date, siContract: siSpec.contract, brContract: brSpec.contract, status: 'special_session' });
      continue;
    }
    const si = readCachedSi2026Day(siSpec);
    const br = readCachedBrDay(brSpec);
    decisions.push(evaluateSiFromBrentLead(siSpec.date, siSpec.contract, brSpec.contract, br.candles, si.candles));
  }
  const combined = summarize(decisions);
  const regular = decisions.filter((decision) => decision.status !== 'special_session');
  const months = [...new Set(regular.map((decision) => decision.date.slice(0, 7)))];
  const byMonth = Object.fromEntries(months.map((month) => [month, summarize(regular.filter((decision) => decision.date.startsWith(month)))]));
  const bySiContract = Object.fromEntries(['SiM6', 'SiU6', 'SiZ6'].map((contract) => [contract, summarize(regular.filter((decision) => decision.siContract === contract))]));
  const bySide = Object.fromEntries(['long', 'short'].map((side) => [side, summarize(regular.filter((decision) => decision.side === side))]));
  const blocks = {
    marchMay: summarize(regular.filter((decision) => decision.date < '2026-06-01')),
    juneSeptember: summarize(regular.filter((decision) => decision.date >= '2026-06-01')),
  };
  const bestMonthSum = Math.max(...Object.values(byMonth).map((summary) => summary.sumBaseNet!));
  const withoutBestMonthSum = combined.sumBaseNet! - bestMonthSum;
  const passesGate = combined.trades! >= 100 && combined.signals! >= 50 &&
    combined.missingBrHistory === 0 && combined.cancelledEntry === 0 && combined.unresolvedHolding === 0 &&
    combined.winRate! >= 0.51 && combined.meanBaseNet! > 0 && combined.meanStressNet! > 0 &&
    combined.profitFactor! > 1 && combined.withoutBestDateSum! > 0 && withoutBestMonthSum > 0 &&
    blocks.marchMay.trades! > 0 && blocks.marchMay.meanBaseNet! > 0 &&
    blocks.juneSeptember.trades! > 0 && blocks.juneSeptember.meanBaseNet! > 0;
  const report = {
    protocolSha256: sha256(readFileSync(protocolPath)),
    sourceReportSha256: { Si: lockedSiSha256, BR: lockedBrSha256 },
    status: passesGate ? 'candidate-for-independent-check-only' : 'failed-or-insufficient-development-gate',
    costs: { commissionPerSide: 0.001, baseSlippagePerSide: 0.0005, stressSlippagePerSide: 0.001 },
    combined, blocks, byMonth, bySiContract, bySide, withoutBestMonthSum, decisions,
  };
  const temporary = `${reportPath}.part`;
  writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, reportPath);
  console.log(JSON.stringify({ status: report.status, combined, blocks, bySiContract, withoutBestMonthSum, reportPath }));
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  try { main(); } catch (error) {
    console.error(`Si-from-Brent research failed: ${error instanceof Error ? error.message : 'unknown failure'}`);
    process.exitCode = 1;
  }
}
