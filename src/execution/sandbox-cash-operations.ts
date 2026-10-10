import type { SandboxOrderSnapshot } from './sandbox-order-state.js';

export type SandboxCashOperationsWindow = {
  version: 1;
  accountId: string;
  from: string;
  to: string;
  pages: Array<{ cursor: string | null; payload: unknown }>;
};

export type SandboxCashOperationsOwnership = {
  instrumentId: string;
  entry: SandboxOrderSnapshot;
  exit: SandboxOrderSnapshot;
  lotSize: number;
  failedCloseFeesNano: string | null;
};

const invalid = 'Sandbox cash operations evidence is invalid';
const unsigned = /^(0|[1-9]\d{0,39})$/;
const maxPages = 10, maxItems = 1_000, maxTrades = 1_000;
const billion = 1_000_000_000n;

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(invalid);
  return value as Record<string, unknown>;
}

function id(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 256 || value.trim() !== value
    || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(invalid);
  return value;
}

// Compare timestamps without silently truncating broker nanoseconds to JS ms.
function time(value: unknown): bigint {
  if (typeof value !== 'string') throw new Error(invalid);
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(value);
  if (!match) throw new Error(invalid);
  const at = Date.parse(`${match[1]}.000Z`);
  if (!Number.isFinite(at) || new Date(at).toISOString() !== `${match[1]}.000Z`) throw new Error(invalid);
  return BigInt(at) * 1_000_000n + BigInt((match[2] ?? '').padEnd(9, '0'));
}

/** Shared lossless UTC timestamp check for causal cash/fill boundaries. */
export function sandboxCashTimestampNano(value: string): bigint { return time(value); }

function integer(value: unknown): bigint {
  if (typeof value !== 'string' || !unsigned.test(value)) throw new Error(invalid);
  return BigInt(value);
}

function quantity(value: unknown): bigint {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000_000) throw new Error(invalid);
    return BigInt(value);
  }
  const result = integer(value);
  if (result > 1_000_000_000_000n) throw new Error(invalid);
  return result;
}

function money(value: unknown): bigint {
  const item = object(value);
  if (item.currency !== 'rub' || typeof item.units !== 'string' || !/^(0|-?[1-9]\d{0,11})$/.test(item.units)
    || typeof item.nano !== 'number' || !Number.isInteger(item.nano) || Math.abs(item.nano) > 999_999_999
    || Object.is(item.nano, -0)) throw new Error(invalid);
  const units = BigInt(item.units), nano = BigInt(item.nano);
  if ((units < 0n && nano > 0n) || (units > 0n && nano < 0n)) throw new Error(invalid);
  return units * billion + nano;
}

function trades(item: Record<string, unknown>): Array<Record<string, unknown>> {
  if (item.tradesInfo === undefined) return [];
  const info = object(item.tradesInfo);
  if (!Array.isArray(info.trades) || info.trades.length > maxTrades) throw new Error(invalid);
  return info.trades.map(object);
}

export function assertSandboxCashOperationsWindow(value: unknown): asserts value is SandboxCashOperationsWindow {
  try {
    const window = object(value);
    if (window.version !== 1) throw new Error(invalid);
    id(window.accountId);
    if (time(window.from) > time(window.to) || !Array.isArray(window.pages)
      || window.pages.length === 0 || window.pages.length > maxPages) throw new Error(invalid);
    const pages = window.pages;
    let expectedCursor: string | null = null, itemCount = 0, tradeCount = 0;
    const cursors = new Set<string>(), operationIds = new Set<string>(), tradeIds = new Set<string>();
    for (const [index, rawPage] of pages.entries()) {
      const page = object(rawPage), payload = object(page.payload);
      if (page.cursor !== expectedCursor || typeof payload.hasNext !== 'boolean' || typeof payload.nextCursor !== 'string'
        || !Array.isArray(payload.items)) throw new Error(invalid);
      itemCount += payload.items.length;
      if (itemCount > maxItems) throw new Error(invalid);
      for (const rawItem of payload.items) {
        const item = object(rawItem), operationId = id(item.id);
        if (operationIds.has(operationId)) throw new Error(invalid);
        operationIds.add(operationId);
        for (const trade of trades(item)) {
          const tradeId = id(trade.num);
          if (tradeIds.has(tradeId) || ++tradeCount > maxTrades) throw new Error(invalid);
          tradeIds.add(tradeId);
        }
      }
      if (payload.hasNext) {
        const next = id(payload.nextCursor);
        if (index === pages.length - 1 || cursors.has(next)) throw new Error(invalid);
        cursors.add(next); expectedCursor = next;
      } else {
        if (index !== pages.length - 1 || payload.nextCursor !== '') throw new Error(invalid);
        expectedCursor = null;
      }
    }
  } catch { throw new Error(invalid); }
}

function snapshot(value: SandboxOrderSnapshot, lotSize: number, ids: Set<string>): Map<string, SandboxOrderSnapshot['stages'][number]> {
  if (!value.terminal || !['EXECUTION_REPORT_STATUS_FILL', 'EXECUTION_REPORT_STATUS_CANCELLED'].includes(value.executionStatus)
    || !Number.isSafeInteger(value.lotsExecuted) || value.lotsExecuted <= 0 || value.lotsExecuted > 1_000_000
    || !Array.isArray(value.stages) || value.stages.length === 0 || value.stages.length > maxTrades) throw new Error(invalid);
  id(value.brokerOrderId);
  integer(value.commissionNano);
  let lots = 0, gross = 0n;
  const result = new Map<string, SandboxOrderSnapshot['stages'][number]>();
  for (const stage of value.stages) {
    const tradeId = id(stage.tradeId), price = integer(stage.priceNano);
    if (ids.has(tradeId) || price <= 0n || !Number.isSafeInteger(stage.lots) || stage.lots <= 0
      || stage.lots > 1_000_000 || Boolean(stage.evidenceSource) !== Boolean(stage.operationId)
      || (stage.evidenceSource !== undefined && stage.evidenceSource !== 'sandbox-operation')) throw new Error(invalid);
    if (stage.operationId !== undefined) id(stage.operationId);
    time(stage.executedAt);
    ids.add(tradeId); result.set(tradeId, stage); lots += stage.lots;
    gross += price * BigInt(stage.lots) * BigInt(lotSize);
  }
  if (lots !== value.lotsExecuted || gross !== integer(value.grossNano)) throw new Error(invalid);
  return result;
}

/** Complete cursor coverage must contain ONLY the exactly owned fill trades and
 * their broker-fee rows. Operation IDs are never inferred from order UUIDs.
 * Broker operation/parent IDs may change between reads: validate their linkage
 * afresh within this window, not against a previously captured operation ID.
 * Commission summaries validate separate fee payments, not additional cash.
 */
export function assessSandboxCashOperations(window: SandboxCashOperationsWindow, expected: {
  accountId: string; from: string; to: string;
} & SandboxCashOperationsOwnership): { complete: boolean; paymentNano: string | null; reasons: string[] } {
  try { assertSandboxCashOperationsWindow(window); }
  catch { return { complete: false, paymentNano: null, reasons: ['cash-operations-window-invalid'] }; }
  try {
    if (window.accountId !== expected.accountId || window.from !== expected.from || window.to !== expected.to
      || !Number.isSafeInteger(expected.lotSize) || expected.lotSize <= 0 || expected.lotSize > 1_000_000
      || expected.entry.lotsExecuted !== expected.exit.lotsExecuted) throw new Error(invalid);
    id(expected.instrumentId);
    if (expected.failedCloseFeesNano !== '0') {
      return { complete: false, paymentNano: null, reasons: ['cash-operations-failed-close-fees-unconfirmed'] };
    }
    const ids = new Set<string>();
    const entry = snapshot(expected.entry, expected.lotSize, ids), exit = snapshot(expected.exit, expected.lotSize, ids);
    const from = time(window.from), to = time(window.to), seen = new Set<string>();
    const fees = new Map<string, bigint>(), summaries = new Map<string, bigint>();
    let payment = 0n, entryFees = 0n, exitFees = 0n;
    const items = window.pages.flatMap(page => object(page.payload).items as unknown[]).map(object);
    for (const item of items) {
      const at = time(item.date), operationId = id(item.id);
      if (item.brokerAccountId !== expected.accountId || at < from || at > to
        || item.state !== 'OPERATION_STATE_EXECUTED'
        || (item.childOperations !== undefined && (!Array.isArray(item.childOperations) || item.childOperations.length !== 0))) throw new Error(invalid);
      const amount = money(item.payment);
      if (item.type === 'OPERATION_TYPE_BROKER_FEE') {
        const parent = id(item.parentOperationId);
        if (amount >= 0n || trades(item).length !== 0) throw new Error(invalid);
        fees.set(parent, (fees.get(parent) ?? 0n) - amount); payment += amount;
        continue;
      }
      if (!['OPERATION_TYPE_BUY', 'OPERATION_TYPE_SELL'].includes(item.type as string)
        || item.instrumentUid !== expected.instrumentId) throw new Error(invalid);
      const buy = item.type === 'OPERATION_TYPE_BUY', stages = buy ? entry : exit;
      const operationTrades = trades(item);
      if (operationTrades.length === 0 || quantity(item.quantityRest) !== 0n) throw new Error(invalid);
      let units = 0n, gross = 0n;
      for (const trade of operationTrades) {
        const tradeId = id(trade.num), stage = stages.get(tradeId), tradeAt = time(trade.date);
        if (!stage || seen.has(tradeId) || tradeAt < from || tradeAt > to || tradeAt !== time(stage.executedAt)
          || money(trade.price) !== integer(stage.priceNano)
          || quantity(trade.quantity) !== BigInt(stage.lots) * BigInt(expected.lotSize)) throw new Error(invalid);
        seen.add(tradeId); units += quantity(trade.quantity); gross += money(trade.price) * quantity(trade.quantity);
      }
      if (quantity(item.quantity) !== units || quantity(item.quantityDone) !== units
        || money(item.price) * units !== gross || amount !== (buy ? -gross : gross)) throw new Error(invalid);
      const summary = money(item.commission), fee = summary < 0n ? -summary : summary;
      summaries.set(operationId, fee);
      if (buy) entryFees += fee; else exitFees += fee;
      payment += amount;
    }
    if (seen.size !== ids.size || entryFees !== integer(expected.entry.commissionNano)
      || exitFees !== integer(expected.exit.commissionNano)) throw new Error(invalid);
    for (const [operationId, summary] of summaries) if ((fees.get(operationId) ?? 0n) !== summary) throw new Error(invalid);
    for (const parent of fees.keys()) if (!summaries.has(parent)) throw new Error(invalid);
    const net = integer(expected.exit.grossNano) - integer(expected.entry.grossNano) - entryFees - exitFees;
    if (payment !== net) throw new Error(invalid);
    return { complete: true, paymentNano: String(payment), reasons: [] };
  } catch {
    return { complete: false, paymentNano: null, reasons: ['cash-operations-ownership-unconfirmed'] };
  }
}
