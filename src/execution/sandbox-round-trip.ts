import type { SandboxOrderSnapshot } from './sandbox-order-state.js';
import { sandboxCashTimestampNano } from './sandbox-cash-operations.js';

function validate(snapshot: SandboxOrderSnapshot, lotSize: number) {
  const statuses = ['EXECUTION_REPORT_STATUS_FILL', 'EXECUTION_REPORT_STATUS_PARTIALLYFILL', 'EXECUTION_REPORT_STATUS_NEW',
    'EXECUTION_REPORT_STATUS_CANCELLED', 'EXECUTION_REPORT_STATUS_REJECTED'];
  const terminal = ['EXECUTION_REPORT_STATUS_FILL', 'EXECUTION_REPORT_STATUS_CANCELLED', 'EXECUTION_REPORT_STATUS_REJECTED'].includes(snapshot.executionStatus);
  if (!Number.isSafeInteger(lotSize) || lotSize <= 0 || lotSize > 1_000_000
    || !statuses.includes(snapshot.executionStatus) || terminal !== snapshot.terminal
    || (snapshot.executionStatus === 'EXECUTION_REPORT_STATUS_NEW' && snapshot.lotsExecuted !== 0)
    || !Number.isSafeInteger(snapshot.lotsExecuted) || snapshot.lotsExecuted < 0 || snapshot.lotsExecuted > 1_000_000
    || !/^\d{1,40}$/.test(snapshot.grossNano)
    || (snapshot.commissionNano !== null && !/^\d{1,40}$/.test(snapshot.commissionNano))) throw new Error('Invalid sandbox fill amounts');
  let lots = 0; let gross = 0n; const ids = new Set<string>();
  for (const stage of snapshot.stages) {
    if (!stage.tradeId || ids.has(stage.tradeId) || !Number.isSafeInteger(stage.lots) || stage.lots <= 0
      || !/^\d{1,30}$/.test(stage.priceNano) || BigInt(stage.priceNano) <= 0n) throw new Error('Invalid sandbox fill stages');
    sandboxCashTimestampNano(stage.executedAt);
    lots += stage.lots; gross += BigInt(stage.priceNano) * BigInt(stage.lots) * BigInt(lotSize); ids.add(stage.tradeId);
  }
  if (lots !== snapshot.lotsExecuted || gross !== BigInt(snapshot.grossNano)) throw new Error('Incomplete sandbox fill stages');
}

export function analyzeSandboxRoundTrip(entry: SandboxOrderSnapshot, exit: SandboxOrderSnapshot, lotSize: number) {
  validate(entry, lotSize); validate(exit, lotSize);
  if (!entry.terminal || entry.lotsExecuted <= 0 || exit.lotsExecuted > entry.lotsExecuted || entry.brokerOrderId === exit.brokerOrderId) {
    throw new Error('Sandbox exit contradicts the confirmed entry');
  }
  const boughtIds = new Set(entry.stages.map(stage => stage.tradeId));
  const lastEntry = entry.stages.reduce((latest, stage) => {
    const at = sandboxCashTimestampNano(stage.executedAt); return at > latest ? at : latest;
  }, sandboxCashTimestampNano(entry.stages[0]!.executedAt));
  if (exit.stages.some(stage => boughtIds.has(stage.tradeId) || sandboxCashTimestampNano(stage.executedAt) < lastEntry)) {
    throw new Error('Sandbox exit precedes or reuses entry fills');
  }
  const fullySold = exit.terminal && exit.lotsExecuted === entry.lotsExecuted;
  // Actual fills already contain the execution price effect. Never subtract
  // forecast slippage a second time. Missing fees and partial exits stay unknown.
  const netPnlNano = fullySold && entry.commissionNano !== null && exit.commissionNano !== null
    ? String(BigInt(exit.grossNano) - BigInt(entry.grossNano) - BigInt(entry.commissionNano) - BigInt(exit.commissionNano)) : null;
  return { soldLots: exit.lotsExecuted, remainingLots: entry.lotsExecuted - exit.lotsExecuted, fullySold, netPnlNano,
    closedAt: fullySold ? exit.stages.reduce((latest, stage) => sandboxCashTimestampNano(stage.executedAt)
      > sandboxCashTimestampNano(latest) ? stage.executedAt : latest, exit.stages[0]!.executedAt) : null };
}

// Display only: profits rounded down, losses away from zero to kopeks. Exact
// nanoruble evidence remains the monetary source of truth in the private journal.
export function formatNanoRub(value: string): string {
  if (!/^-?\d{1,40}$/.test(value)) throw new Error('Invalid sandbox PnL');
  const amount = BigInt(value); const negative = amount < 0n; const magnitude = negative ? -amount : amount;
  const cents = (magnitude + (negative ? 9_999_999n : 0n)) / 10_000_000n;
  return `${negative ? '−' : ''}${cents / 100n},${String(cents % 100n).padStart(2, '0')} ₽`;
}
