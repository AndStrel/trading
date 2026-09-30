import { z } from 'zod/v4';

const statuses = z.enum([
  'EXECUTION_REPORT_STATUS_FILL', 'EXECUTION_REPORT_STATUS_PARTIALLYFILL',
  'EXECUTION_REPORT_STATUS_NEW', 'EXECUTION_REPORT_STATUS_REJECTED',
  'EXECUTION_REPORT_STATUS_CANCELLED',
]);
const identifier = z.string().min(1).max(256).regex(/^[^\u0000-\u001f\u007f]+$/);
const integer = z.union([z.number(), z.string().regex(/^\d{1,7}$/)])
  .transform(Number).pipe(z.number().int().min(0).max(1_000_000));
const money = z.object({
  currency: z.string().transform(value => value.toLowerCase()).pipe(z.literal('rub')),
  units: z.string().regex(/^\d{1,12}$/).default('0'),
  nano: z.number().int().min(0).max(999_999_999).default(0),
});
const stage = z.object({
  tradeId: identifier,
  price: money,
  quantity: integer.pipe(z.number().positive()),
  executionTime: z.iso.datetime({ offset: true }),
});
const state = z.object({
  orderId: identifier, orderRequestId: identifier.optional(), instrumentUid: identifier,
  direction: z.enum(['ORDER_DIRECTION_BUY', 'ORDER_DIRECTION_SELL']), orderType: z.literal('ORDER_TYPE_LIMIT'),
  executionReportStatus: statuses,
  lotsRequested: integer.pipe(z.number().positive()), lotsExecuted: integer,
  currency: z.string().transform(value => value.toLowerCase()).pipe(z.literal('rub')),
  stages: z.array(stage).max(10_000).default([]),
  executedCommission: money.optional(), serviceCommission: money.optional(),
});

export type SandboxOrderSnapshot = {
  brokerOrderId: string;
  executionStatus: z.infer<typeof statuses>;
  lotsExecuted: number;
  terminal: boolean;
  grossNano: string;
  // Missing monetary fields are not proof of zero fees.
  commissionNano: string | null;
  stages: Array<{ tradeId: string; lots: number; priceNano: string; executedAt: string }>;
};

function nano(value: z.infer<typeof money>): bigint {
  return BigInt(value.units) * 1_000_000_000n + BigInt(value.nano);
}

export function parseSandboxOrderState(payload: unknown, expected: {
  requestId: string; instrumentId: string; lots: number; lotSize: number;
}, now = new Date()): SandboxOrderSnapshot {
  return parseOrderState(payload, { ...expected, kind: 'entry' }, now);
}

// Stop-generated children do not have OUR request UUID. Only the exchange ID
// obtained from the already acknowledged, exactly matched stop is admissible.
export function parseSandboxExitOrderState(payload: unknown, expected: {
  brokerOrderId: string; instrumentId: string; lots: number; lotSize: number; notBefore: string;
}, now = new Date()): SandboxOrderSnapshot {
  return parseOrderState(payload, { ...expected, kind: 'exit' }, now);
}

// Our session exit is looked up by its durable request UUID, never by a
// similarly priced SELL. The known exchange acknowledgement must also match.
export function parseSandboxSessionExitOrderState(payload: unknown, expected: {
  requestId: string; brokerOrderId: string | null; instrumentId: string; lots: number; lotSize: number; notBefore: string;
}, now = new Date()): SandboxOrderSnapshot {
  return parseOrderState(payload, { ...expected, kind: 'session-exit' }, now);
}

function parseOrderState(payload: unknown, expected: { instrumentId: string; lots: number; lotSize: number } &
  ({ kind: 'entry'; requestId: string } | { kind: 'exit'; brokerOrderId: string; notBefore: string }
    | { kind: 'session-exit'; requestId: string; brokerOrderId: string | null; notBefore: string }), now: Date): SandboxOrderSnapshot {
  try {
    const parsed = state.parse(payload);
    if ((expected.kind === 'entry' && (parsed.orderRequestId !== expected.requestId || parsed.direction !== 'ORDER_DIRECTION_BUY'))
      || (expected.kind === 'exit' && (parsed.orderId !== expected.brokerOrderId || parsed.direction !== 'ORDER_DIRECTION_SELL'
        || !Number.isFinite(Date.parse(expected.notBefore))))
      || (expected.kind === 'session-exit' && (parsed.orderRequestId !== expected.requestId || parsed.direction !== 'ORDER_DIRECTION_SELL'
        || (expected.brokerOrderId !== null && parsed.orderId !== expected.brokerOrderId) || !Number.isFinite(Date.parse(expected.notBefore))))
      || parsed.instrumentUid !== expected.instrumentId
      || parsed.lotsRequested !== expected.lots || parsed.lotsExecuted > expected.lots
      || !Number.isFinite(now.getTime())
      || !Number.isSafeInteger(expected.lotSize) || expected.lotSize <= 0 || expected.lotSize > 1_000_000) {
      throw new Error('Identity or lot size mismatch');
    }
    const status = parsed.executionReportStatus;
    if ((status === 'EXECUTION_REPORT_STATUS_FILL' && parsed.lotsExecuted !== expected.lots)
      || (status === 'EXECUTION_REPORT_STATUS_NEW' && parsed.lotsExecuted !== 0)
      || (status === 'EXECUTION_REPORT_STATUS_PARTIALLYFILL'
        && (parsed.lotsExecuted === 0 || parsed.lotsExecuted === expected.lots))) {
      throw new Error('Inconsistent execution status');
    }
    const ids = new Set<string>();
    let lots = 0;
    let gross = 0n;
    const stages = parsed.stages.map(item => {
      const price = nano(item.price);
      const executedAt = new Date(item.executionTime);
      if (ids.has(item.tradeId) || price <= 0n || executedAt.getTime() > now.getTime() + 60_000
        || (expected.kind !== 'entry' && executedAt.getTime() < Date.parse(expected.notBefore))) {
        throw new Error('Invalid execution stage');
      }
      ids.add(item.tradeId);
      lots += item.quantity;
      gross += price * BigInt(item.quantity) * BigInt(expected.lotSize);
      return { tradeId: item.tradeId, lots: item.quantity, priceNano: String(price), executedAt: executedAt.toISOString() };
    });
    if (lots !== parsed.lotsExecuted) throw new Error('Incomplete execution stages');
    return {
      brokerOrderId: parsed.orderId, executionStatus: status, lotsExecuted: lots,
      terminal: ['EXECUTION_REPORT_STATUS_FILL', 'EXECUTION_REPORT_STATUS_REJECTED', 'EXECUTION_REPORT_STATUS_CANCELLED'].includes(status),
      grossNano: String(gross),
      commissionNano: parsed.executedCommission && parsed.serviceCommission
        ? String(nano(parsed.executedCommission) + nano(parsed.serviceCommission)) : null,
      stages,
    };
  } catch {
    // Never expose broker payloads, identities, raw validation failures or secrets.
    throw new Error('Sandbox order state is incomplete, inconsistent or does not match the request');
  }
}

export function assertSnapshotProgress(previous: SandboxOrderSnapshot, next: SandboxOrderSnapshot): void {
  if (previous.brokerOrderId !== next.brokerOrderId || previous.lotsExecuted > next.lotsExecuted
    || BigInt(previous.grossNano) > BigInt(next.grossNano)
    || (previous.terminal && (previous.executionStatus !== next.executionStatus || previous.lotsExecuted !== next.lotsExecuted))
    || (previous.commissionNano !== null
      && (next.commissionNano === null || BigInt(next.commissionNano) < BigInt(previous.commissionNano)))) {
    throw new Error('Sandbox reconciliation contradicts earlier execution evidence');
  }
  const stages = new Map(next.stages.map(item => [item.tradeId, item]));
  for (const prior of previous.stages) {
    const current = stages.get(prior.tradeId);
    if (!current || prior.lots !== current.lots || prior.priceNano !== current.priceNano || prior.executedAt !== current.executedAt) {
      throw new Error('Sandbox reconciliation contradicts earlier execution evidence');
    }
  }
}
