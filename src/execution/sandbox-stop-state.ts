import { z } from 'zod/v4';

const id = z.string().min(1).max(256).regex(/^[^\u0000-\u001f\u007f]+$/);
const integer = z.union([z.number(), z.string().regex(/^\d{1,13}$/)])
  .transform(Number).pipe(z.number().int().min(0).max(1_000_000_000_000));
const money = z.object({ currency: z.string().transform(s => s.toLowerCase()).pipe(z.literal('rub')),
  units: z.string().regex(/^\d{1,12}$/).default('0'), nano: z.number().int().min(0).max(999_999_999).default(0) });
const status = z.enum(['STOP_ORDER_STATUS_ACTIVE', 'STOP_ORDER_STATUS_EXECUTED', 'STOP_ORDER_STATUS_CANCELED', 'STOP_ORDER_STATUS_EXPIRED']);
const listing = z.object({ stopOrders: z.array(z.object({ stopOrderId: id, status })).max(1000) });
const observed = z.object({ stopOrderId: id, status, instrumentUid: id, currency: z.string().transform(s => s.toLowerCase()).pipe(z.literal('rub')),
  direction: z.literal('STOP_ORDER_DIRECTION_SELL'), orderType: z.literal('STOP_ORDER_TYPE_STOP_LIMIT'),
  lotsRequested: integer.pipe(z.number().positive()), stopPrice: money, price: money,
  createDate: z.iso.datetime({ offset: true }), exchangeOrderId: id.optional(),
  exchangeOrderType: z.enum(['EXCHANGE_ORDER_TYPE_UNSPECIFIED', 'EXCHANGE_ORDER_TYPE_LIMIT']).optional() });

export type SandboxStopIntent = {
  scenarioId: number; accountId: string; requestId: string; instrumentId: string;
  entryRequestId: string; lots: number; stopNano: string; limitNano: string; createdAt: string;
  brokerStopId: string | null;
  generation?: number;
};
export type NativeStopKey = { scenarioId: number; generation: number; requestId: string; brokerStopId: string | null };
export function nativeStopKey(intent: SandboxStopIntent): NativeStopKey {
  const generation = intent.generation ?? 0;
  if (!Number.isSafeInteger(generation) || generation < 0 || generation > 1_000_000) throw new Error('Invalid native stop generation');
  return { scenarioId: intent.scenarioId, generation, requestId: intent.requestId, brokerStopId: intent.brokerStopId };
}
export type SandboxStopObservation = { status: z.infer<typeof status>; childOrderId: string | null };

export function decimalPriceNano(value: number): string {
  if (!Number.isFinite(value) || value <= 0 || value > 1_000_000) throw new Error('Invalid stop price');
  const [mantissa = '', exponent = '0'] = String(value).toLowerCase().split('e');
  const [whole = '', fraction = ''] = mantissa.split('.');
  const digits = BigInt(whole + fraction); const shift = 9 + Number(exponent) - fraction.length;
  if (shift < 0 && digits % (10n ** BigInt(-shift)) !== 0n) throw new Error('Stop price exceeds nanoruble precision');
  return String(shift >= 0 ? digits * 10n ** BigInt(shift) : digits / (10n ** BigInt(-shift)));
}
export function nanoQuotation(value: string): { units: string; nano: number } {
  if (!/^\d{1,16}$/.test(value)) throw new Error('Invalid stop price');
  const nano = BigInt(value); if (nano <= 0n || nano > 1_000_000_000_000_000n) throw new Error('Invalid stop price');
  return { units: String(nano / 1_000_000_000n), nano: Number(nano % 1_000_000_000n) };
}
function moneyNano(value: z.infer<typeof money>): bigint { return BigInt(value.units) * 1_000_000_000n + BigInt(value.nano); }

export function assertNoActiveSandboxStops(payload: unknown): void {
  try { if (listing.parse(payload).stopOrders.some(stop => stop.status === 'STOP_ORDER_STATUS_ACTIVE')) throw new Error(); }
  catch { throw new Error('Sandbox stop book is incomplete or has another active stop'); }
}
export function parseSandboxStop(payload: unknown, intent: SandboxStopIntent, now = new Date()): SandboxStopObservation {
  try {
    if (!intent.brokerStopId) throw new Error();
    const book = listing.parse(payload).stopOrders;
    if (book.some(stop => stop.stopOrderId !== intent.brokerStopId && stop.status === 'STOP_ORDER_STATUS_ACTIVE')) throw new Error();
    const matches = book.filter(stop => stop.stopOrderId === intent.brokerStopId);
    if (matches.length !== 1) throw new Error();
    const raw = (payload as { stopOrders: unknown[] }).stopOrders.find(stop => (stop as { stopOrderId?: unknown }).stopOrderId === intent.brokerStopId);
    const stop = observed.parse(raw); const created = Date.parse(stop.createDate); const intended = Date.parse(intent.createdAt);
    if (stop.instrumentUid !== intent.instrumentId || stop.lotsRequested !== intent.lots
      || moneyNano(stop.stopPrice) !== BigInt(intent.stopNano) || moneyNano(stop.price) !== BigInt(intent.limitNano)
      || !Number.isFinite(intended) || !Number.isFinite(now.getTime())
      || created < intended - 60_000 || created > now.getTime() + 60_000
      || (stop.status !== 'STOP_ORDER_STATUS_EXECUTED' && stop.exchangeOrderId)
      || (stop.status === 'STOP_ORDER_STATUS_EXECUTED' && !stop.exchangeOrderId)) throw new Error();
    return { status: stop.status, childOrderId: stop.exchangeOrderId ?? null };
  } catch { throw new Error('Sandbox stop identity or state is not confirmed'); }
}

// A whole-lot, exclusive RUB share position is required. Unknown/missing fields
// are not treated as an empty account. These snapshots are never logged.
const positions = z.object({ accountId: id, limitsLoadingInProgress: z.literal(false),
  securities: z.array(z.object({ instrumentUid: id, balance: integer, blocked: integer,
    exchangeBlocked: z.literal(false), instrumentType: z.literal('share') })).max(1000),
  futures: z.array(z.unknown()).max(1000), options: z.array(z.unknown()).max(1000) });
export function assertSandboxPosition(payload: unknown, accountId: string, instrumentId: string, units: bigint): void {
  try {
    const p = positions.parse(payload);
    if (p.accountId !== accountId || p.futures.length || p.options.length || p.securities.length !== 1) throw new Error();
    const share = p.securities[0]!;
    if (share.instrumentUid !== instrumentId || share.blocked !== 0 || BigInt(share.balance) !== units) throw new Error();
  } catch { throw new Error('Sandbox position is incomplete or differs from confirmed fills'); }
}
