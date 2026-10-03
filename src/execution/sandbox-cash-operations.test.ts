import { describe, expect, it } from 'vitest';
import {
  assertSandboxCashOperationsWindow, assessSandboxCashOperations,
  type SandboxCashOperationsWindow, type SandboxCashOperationsOwnership,
} from './sandbox-cash-operations.js';
import { analyzeSandboxCashReconciliation, type SandboxCashBaseline, type SandboxCashObservation } from './sandbox-cash-reconciliation.js';
import type { SandboxOrderSnapshot } from './sandbox-order-state.js';

const from = '2026-10-01T10:00:00.000Z', to = '2026-10-01T10:02:01.000Z';
const entryAt = '2026-10-01T10:00:02.000Z', exitAt = '2026-10-01T10:01:00.000Z';
const cash = (units: string, nano = 0) => ({ currency: 'rub', units, nano });
const order = (side: 'entry' | 'exit', price: string, commissionNano = '1000000000'): SandboxOrderSnapshot => ({
  brokerOrderId: `synthetic-${side}-exchange`, executionStatus: 'EXECUTION_REPORT_STATUS_FILL', lotsExecuted: 1,
  terminal: true, grossNano: `${price}000000000`, commissionNano,
  stages: [{ tradeId: `synthetic-${side}-trade`, lots: 1, priceNano: `${price}000000000`,
    executedAt: side === 'entry' ? entryAt : exitAt }],
});
const tradeOperation = (side: 'entry' | 'exit') => ({
  brokerAccountId: 'synthetic-account', id: `synthetic-${side}-operation`, date: side === 'entry' ? entryAt : exitAt,
  type: side === 'entry' ? 'OPERATION_TYPE_BUY' : 'OPERATION_TYPE_SELL', state: 'OPERATION_STATE_EXECUTED',
  instrumentUid: 'synthetic-instrument', payment: cash(side === 'entry' ? '-100' : '110'),
  price: cash(side === 'entry' ? '100' : '110'), commission: cash('1'),
  quantity: '1', quantityRest: '0', quantityDone: '1', childOperations: [],
  tradesInfo: { trades: [{ num: `synthetic-${side}-trade`, date: side === 'entry' ? entryAt : exitAt,
    quantity: '1', price: cash(side === 'entry' ? '100' : '110') }] },
});
const feeOperation = (side: 'entry' | 'exit') => ({
  brokerAccountId: 'synthetic-account', id: `synthetic-${side}-fee`, parentOperationId: `synthetic-${side}-operation`,
  date: side === 'entry' ? entryAt : exitAt, type: 'OPERATION_TYPE_BROKER_FEE',
  state: 'OPERATION_STATE_EXECUTED', payment: cash('-1'),
});
const fixture = () => {
  const items = [tradeOperation('entry'), tradeOperation('exit'), feeOperation('entry'), feeOperation('exit')];
  const window: SandboxCashOperationsWindow = { version: 1, accountId: 'synthetic-account', from, to,
    pages: [{ cursor: null, payload: { hasNext: false, nextCursor: '', items } }] };
  const ownership: SandboxCashOperationsOwnership = { instrumentId: 'synthetic-instrument',
    entry: order('entry', '100'), exit: order('exit', '110'), lotSize: 1, failedCloseFeesNano: '0' };
  const expected = { ...ownership, accountId: window.accountId, from, to };
  return { window, expected, ownership, items };
};
const assess = (value: ReturnType<typeof fixture>) => assessSandboxCashOperations(value.window, value.expected);
const incomplete = (value: ReturnType<typeof fixture>) => expect(assess(value)).toMatchObject({ complete: false, paymentNano: null });

describe('Bounded complete cursor evidence', () => {
  it('requires and accepts terminal coverage, with no guessed operation/order identity', () => {
    const value = fixture();
    expect(() => assertSandboxCashOperationsWindow(value.window)).not.toThrow();
    expect(assess(value)).toEqual({ complete: true, paymentNano: '8000000000', reasons: [] });
    expect(value.expected.entry.brokerOrderId).not.toBe(value.items[0]!.id);
  });
  it('accepts exact cursor chaining across pages and fees before their parent row', () => {
    const value = fixture();
    value.window.pages = [
      { cursor: null, payload: { hasNext: true, nextCursor: 'synthetic-next', items: [value.items[2], value.items[0]] } },
      { cursor: 'synthetic-next', payload: { hasNext: false, nextCursor: '', items: [value.items[3], value.items[1]] } },
    ];
    expect(assess(value).complete).toBe(true);
  });
  it.each(['first-cursor', 'chain', 'cycle', 'not-terminal', 'premature-terminal', 'terminal-cursor'])('rejects %s cursor evidence', (condition) => {
    const value = fixture();
    value.window.pages = [
      { cursor: null, payload: { hasNext: true, nextCursor: 'next', items: value.items } },
      { cursor: 'next', payload: { hasNext: false, nextCursor: '', items: [] } },
    ];
    if (condition === 'first-cursor') value.window.pages[0]!.cursor = 'not-initial';
    if (condition === 'chain') value.window.pages[1]!.cursor = 'different';
    if (condition === 'cycle') value.window.pages.push({ cursor: 'next', payload: { hasNext: false, nextCursor: '', items: [] } });
    if (condition === 'not-terminal') value.window.pages.pop();
    if (condition === 'premature-terminal') (value.window.pages[0]!.payload as Record<string, unknown>).hasNext = false;
    if (condition === 'terminal-cursor') (value.window.pages[1]!.payload as Record<string, unknown>).nextCursor = 'unexpected';
    expect(() => assertSandboxCashOperationsWindow(value.window)).toThrow('Sandbox cash operations evidence is invalid');
    incomplete(value);
  });
  it.each(['empty', 'eleven-pages', 'too-many-items', 'duplicate-operation', 'duplicate-trade', 'missing-id', 'missing-items', 'missing-hasNext', 'missing-nextCursor'])('rejects %s bounds/shape', (condition) => {
    const value = fixture();
    if (condition === 'empty') value.window.pages = [];
    if (condition === 'eleven-pages') value.window.pages = Array.from({ length: 11 }, (_, index) => ({ cursor: index ? String(index) : null,
      payload: { hasNext: index < 10, nextCursor: index < 10 ? String(index + 1) : '', items: [] } }));
    if (condition === 'too-many-items') (value.window.pages[0]!.payload as Record<string, unknown>).items = Array.from({ length: 1001 }, (_, index) => ({ id: `synthetic-${index}` }));
    if (condition === 'duplicate-operation') value.items.push(value.items[0]!);
    if (condition === 'duplicate-trade') value.items.push({ ...value.items[0]!, id: 'another-synthetic-id' });
    if (condition === 'missing-id') delete (value.items[0] as Record<string, unknown>).id;
    if (condition === 'missing-items') delete (value.window.pages[0]!.payload as Record<string, unknown>).items;
    if (condition === 'missing-hasNext') delete (value.window.pages[0]!.payload as Record<string, unknown>).hasNext;
    if (condition === 'missing-nextCursor') delete (value.window.pages[0]!.payload as Record<string, unknown>).nextCursor;
    expect(() => assertSandboxCashOperationsWindow(value.window)).toThrow('Sandbox cash operations evidence is invalid');
    incomplete(value);
  });
  it('bounds aggregate trade count even when operation count is small', () => {
    const value = fixture(), first = value.items[0] as ReturnType<typeof tradeOperation>;
    first.tradesInfo.trades = Array.from({ length: 1001 }, (_, index) => ({ ...first.tradesInfo.trades[0]!, num: `synthetic-${index}` }));
    incomplete(value);
  });
  it('rejects sparse pages rather than silently skipping a missing page', () => {
    const value = fixture(); value.window.pages.unshift(undefined as never); delete value.window.pages[0];
    expect(() => assertSandboxCashOperationsWindow(value.window)).toThrow('Sandbox cash operations evidence is invalid');
    incomplete(value);
  });
  it('rejects a genuine cursor cycle even when a terminal page follows it', () => {
    const value = fixture(); value.window.pages = [
      { cursor: null, payload: { hasNext: true, nextCursor: 'same-cursor', items: value.items } },
      { cursor: 'same-cursor', payload: { hasNext: true, nextCursor: 'same-cursor', items: [] } },
      { cursor: 'same-cursor', payload: { hasNext: false, nextCursor: '', items: [] } },
    ];
    incomplete(value);
  });
  it('accepts the exact page and operation bounds structurally, but never treats unowned rows as proof', () => {
    const value = fixture(); value.window.pages = Array.from({ length: 10 }, (_, index) => ({ cursor: index ? String(index) : null,
      payload: { hasNext: index < 9, nextCursor: index < 9 ? String(index + 1) : '',
        items: Array.from({ length: 100 }, (_, itemIndex) => ({ id: `synthetic-${index}-${itemIndex}` })) } }));
    expect(() => assertSandboxCashOperationsWindow(value.window)).not.toThrow();
    incomplete(value);
  });
});

describe('Every money-moving row must be exactly owned', () => {
  it.each(['account', 'instrument', 'pending', 'outside-window', 'child', 'foreign-deposit', 'zero-foreign', 'offsetting-foreign'])('blocks %s operation evidence', (condition) => {
    const value = fixture(), item = value.items[0] as Record<string, unknown>;
    if (condition === 'account') item.brokerAccountId = 'other-synthetic-account';
    if (condition === 'instrument') item.instrumentUid = 'other-synthetic-instrument';
    if (condition === 'pending') item.state = 'OPERATION_STATE_PROGRESS';
    if (condition === 'outside-window') item.date = '2026-10-01T09:59:59.999999999Z';
    if (condition === 'child') item.childOperations = [{ id: 'unexplained-child' }];
    if (condition === 'foreign-deposit' || condition === 'zero-foreign' || condition === 'offsetting-foreign') {
      value.items.push({ ...feeOperation('entry'), id: 'foreign-deposit', type: 'OPERATION_TYPE_INPUT',
        payment: cash(condition === 'zero-foreign' ? '0' : '1') });
      if (condition === 'offsetting-foreign') value.items.push({ ...feeOperation('entry'), id: 'foreign-withdrawal', type: 'OPERATION_TYPE_OUTPUT' });
    }
    incomplete(value);
  });
  it.each(['id', 'time', 'sub-ms', 'quantity', 'price', 'gross', 'remaining', 'done', 'average-price', 'missing-trades', 'extra-trade'])('blocks %s trade/quantity proof', (condition) => {
    const value = fixture(), item = value.items[0] as ReturnType<typeof tradeOperation>, trade = item.tradesInfo.trades[0]!;
    if (condition === 'id') trade.num = 'unowned-trade';
    if (condition === 'time') trade.date = exitAt;
    if (condition === 'sub-ms') trade.date = '2026-10-01T10:00:02.000000001Z';
    if (condition === 'quantity') trade.quantity = '2';
    if (condition === 'price') trade.price = cash('100', 1);
    if (condition === 'gross') item.payment = cash('-100', -1);
    if (condition === 'remaining') item.quantityRest = '1';
    if (condition === 'done') item.quantityDone = '0';
    if (condition === 'average-price') item.price = cash('100', 1);
    if (condition === 'missing-trades') item.tradesInfo.trades = [];
    if (condition === 'extra-trade') item.tradesInfo.trades.push({ ...trade, num: 'unowned-extra-trade' });
    incomplete(value);
  });
  it('matches equivalent UTC nanosecond spelling without losing precision', () => {
    const value = fixture(), item = value.items[0] as ReturnType<typeof tradeOperation>;
    item.tradesInfo.trades[0]!.date = '2026-10-01T10:00:02.000000000Z';
    expect(assess(value).complete).toBe(true);
  });
  it('allows changed broker operation IDs between reads while requiring exact fresh fee-parent links', () => {
    const value = fixture();
    Object.assign(value.expected.entry.stages[0]!, { evidenceSource: 'sandbox-operation', operationId: 'synthetic-older-operation' });
    const entry = value.items[0] as ReturnType<typeof tradeOperation>, fee = value.items[2] as ReturnType<typeof feeOperation>;
    entry.id = 'synthetic-newer-operation'; fee.parentOperationId = entry.id;
    expect(assess(value).complete).toBe(true);
    fee.parentOperationId = 'synthetic-older-operation'; incomplete(value);
  });
  it('still rejects malformed historical operation provenance, rather than treating a partial marker as authority', () => {
    const value = fixture(); value.expected.entry.stages[0]!.operationId = 'synthetic-unpaired-operation';
    incomplete(value);
  });
  it.each(['cash-sign', 'missing-nano', 'currency', 'noncanonical-units', 'unsafe-quantity', 'invalid-time'])('blocks %s malformed financial data without leaking it', (condition) => {
    const value = fixture(), item = value.items[0] as Record<string, unknown>;
    if (condition === 'cash-sign') item.payment = cash('-100', 1);
    if (condition === 'missing-nano') item.payment = { currency: 'rub', units: '-100' };
    if (condition === 'currency') item.payment = { currency: 'usd', units: '-100', nano: 0 };
    if (condition === 'noncanonical-units') item.payment = cash('-0100');
    if (condition === 'unsafe-quantity') item.quantityDone = Number.MAX_SAFE_INTEGER + 1;
    if (condition === 'invalid-time') item.date = 'secret-invalid-value';
    incomplete(value);
    expect(JSON.stringify(assess(value))).not.toContain('secret-invalid-value');
  });
  it('uses units rather than lots for non-unit instruments', () => {
    const value = fixture(); value.expected.lotSize = 10;
    for (const side of ['entry', 'exit'] as const) {
      value.expected[side].grossNano = String(BigInt(value.expected[side].grossNano) * 10n);
      const item = value.items[side === 'entry' ? 0 : 1] as ReturnType<typeof tradeOperation>;
      item.quantity = item.quantityDone = item.tradesInfo.trades[0]!.quantity = '10';
      item.payment = cash(side === 'entry' ? '-1000' : '1100');
    }
    expect(assess(value)).toMatchObject({ complete: true, paymentNano: '98000000000' });
  });
  it.each(['different-account', 'different-from', 'different-to', 'open-order', 'unequal-lots', 'invalid-lotSize', 'snapshot-gross', 'snapshot-duplicate'])('blocks %s expected identity', (condition) => {
    const value = fixture();
    if (condition === 'different-account') value.expected.accountId = 'other-synthetic-account';
    if (condition === 'different-from') value.expected.from = entryAt;
    if (condition === 'different-to') value.expected.to = exitAt;
    if (condition === 'open-order') value.expected.entry.terminal = false;
    if (condition === 'unequal-lots') value.expected.exit.lotsExecuted = 2;
    if (condition === 'invalid-lotSize') value.expected.lotSize = 0;
    if (condition === 'snapshot-gross') value.expected.entry.grossNano = '100000000001';
    if (condition === 'snapshot-duplicate') value.expected.exit.stages[0]!.tradeId = value.expected.entry.stages[0]!.tradeId;
    incomplete(value);
  });
});

describe('Actual fee payments must corroborate every commission summary', () => {
  it('does not double-count summaries and separate cash fee rows', () => {
    expect(assess(fixture()).paymentNano).toBe('8000000000');
  });
  it.each(['missing-fee', 'wrong-parent', 'positive-payment', 'one-nano-missing', 'missing-summary', 'missing-snapshot-fee', 'failed-close-null', 'failed-close-positive'])('blocks %s fee evidence', (condition) => {
    const value = fixture(), fee = value.items[2] as ReturnType<typeof feeOperation>;
    if (condition === 'missing-fee') value.items.splice(2, 1);
    if (condition === 'wrong-parent') fee.parentOperationId = value.expected.entry.brokerOrderId;
    if (condition === 'positive-payment') fee.payment = cash('1');
    if (condition === 'one-nano-missing') fee.payment = cash('0', -999_999_999);
    if (condition === 'missing-summary') delete (value.items[0] as Record<string, unknown>).commission;
    if (condition === 'missing-snapshot-fee') value.expected.entry.commissionNano = null;
    if (condition === 'failed-close-null') value.expected.failedCloseFeesNano = null;
    if (condition === 'failed-close-positive') value.expected.failedCloseFeesNano = '1';
    incomplete(value);
  });
  it('accepts explicit zero summaries and known zero failed attempts with no fee cash rows', () => {
    const value = fixture(); value.items.splice(2, 2);
    for (const side of ['entry', 'exit'] as const) value.expected[side].commissionNano = '0';
    for (const item of value.items) (item as ReturnType<typeof tradeOperation>).commission = cash('0');
    expect(assess(value)).toMatchObject({ complete: true, paymentNano: '10000000000' });
  });
  it('accepts negative broker commission summaries by magnitude without adding them to payments', () => {
    const value = fixture(); (value.items[0] as ReturnType<typeof tradeOperation>).commission = cash('-1');
    expect(assess(value)).toMatchObject({ complete: true, paymentNano: '8000000000' });
  });
  it('accepts split broker-fee cash rows only when their exact sum matches the owned parent summary', () => {
    const value = fixture(), fee = value.items[2] as ReturnType<typeof feeOperation>;
    fee.payment = cash('0', -500_000_000);
    value.items.push({ ...fee, id: 'synthetic-split-fee' });
    expect(assess(value)).toMatchObject({ complete: true, paymentNano: '8000000000' });
  });
  it('blocks an additional late one-nano fee even before the order summary is updated', () => {
    const value = fixture(); value.items.push({ ...feeOperation('entry'), id: 'synthetic-late-fee', payment: cash('0', -1) });
    incomplete(value);
  });
});

describe('Cash proof requires all three exact amounts and the bounded ownership window', () => {
  const reconciliation = () => {
    const value = fixture();
    const baseline: SandboxCashBaseline = { version: 1, accountId: 'synthetic-account', entryRequestId: 'synthetic-entry-request',
      cashNano: '1000000000000', observedFrom: from, observedAt: '2026-10-01T10:00:01.000Z',
      ledgerRevision: '1', killGeneration: 'synthetic-generation', preparedRaw: '{"synthetic":true}' };
    const observation: SandboxCashObservation = { version: 1, accountId: baseline.accountId, entryRequestId: baseline.entryRequestId,
      cashNano: '1008000000000', observedFrom: '2026-10-01T10:02:00.000Z', observedAt: to,
      ledgerRevision: '8', epoch: { killGeneration: 'synthetic-current-generation', preparedRaw: '{"synthetic":"current"}',
        selection: { key: 'synthetic-selection', raw: null } }, flowEvidence: value.window };
    return { baseline, observation, ownership: value.ownership, expectedNetNano: '8000000000', closedAt: exitAt,
      flatConfirmedAt: exitAt };
  };
  it('proves exact cash only with complete cursor ownership and independently known actual net', () => {
    expect(analyzeSandboxCashReconciliation(reconciliation())).toEqual({ cashProven: true, status: 'reconciled', reasons: [],
      deltaNano: '8000000000', expectedDeltaNano: '8000000000' });
  });
  it.each(['missing-ownership', 'foreign-offset', 'window-gap', 'cash-1-nano', 'expected-1-nano', 'missing-fees'])('blocks %s even when some monetary equations match', (condition) => {
    const value = reconciliation();
    if (condition === 'missing-ownership') delete (value as { ownership?: SandboxCashOperationsOwnership }).ownership;
    if (condition === 'foreign-offset') {
      const payload = value.observation.flowEvidence!.pages[0]!.payload as { items: unknown[] };
      payload.items.push({ ...feeOperation('entry'), id: 'foreign-deposit', type: 'OPERATION_TYPE_INPUT', payment: cash('1') },
        { ...feeOperation('entry'), id: 'foreign-withdrawal', type: 'OPERATION_TYPE_OUTPUT' });
    }
    if (condition === 'window-gap') value.observation.flowEvidence!.from = entryAt;
    if (condition === 'cash-1-nano') value.observation.cashNano = '1008000000001';
    if (condition === 'expected-1-nano') { value.expectedNetNano = '8000000001'; value.observation.cashNano = '1008000000001'; }
    if (condition === 'missing-fees') value.expectedNetNano = null as never;
    const result = analyzeSandboxCashReconciliation(value);
    expect(result.cashProven).toBe(false);
    expect(result.status).toBe(['cash-1-nano', 'expected-1-nano'].includes(condition) ? 'mismatch' : 'incomplete');
  });
  it.each(['baseline-after-entry', 'close-before-exit'])('requires %s causal cash/fill boundaries', (condition) => {
    const value = reconciliation();
    if (condition === 'baseline-after-entry') value.baseline.observedAt = '2026-10-01T10:00:03.000Z';
    if (condition === 'close-before-exit') value.closedAt = '2026-10-01T10:00:59.999Z';
    const result = analyzeSandboxCashReconciliation(value);
    expect(result).toMatchObject({ cashProven: false, status: 'incomplete' });
    expect(result.reasons).toContain('cash-timestamps-unconfirmed');
  });
  it('never truncates an exit nanosecond beyond closedAt into an apparently matching millisecond', () => {
    const value = reconciliation(); value.ownership.exit.stages[0]!.executedAt = '2026-10-01T10:01:00.000000001Z';
    const payload = value.observation.flowEvidence!.pages[0]!.payload as { items: Array<ReturnType<typeof tradeOperation>> };
    payload.items[1]!.tradesInfo.trades[0]!.date = value.ownership.exit.stages[0]!.executedAt;
    expect(analyzeSandboxCashReconciliation(value).reasons).toContain('cash-timestamps-unconfirmed');
  });
});
