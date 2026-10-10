import { z } from 'zod/v4';
import type { SandboxOrderSnapshot } from './sandbox-order-state.js';
import { analyzeSandboxRoundTrip } from './sandbox-round-trip.js';
import { decimalPriceNano } from './sandbox-stop-state.js';

const scale = 1_000_000_000n; const kopek = 10_000_000n;
const quantity = z.union([z.number(), z.string().regex(/^\d{1,13}$/)]).transform(Number)
  .pipe(z.number().int().min(1).max(1_000_000_000_000));
const quotation = z.object({ units: z.string().regex(/^\d{1,12}$/).default('0'), nano: z.number().int().min(0).max(999_999_999).default(0) });
const level = z.object({ price: quotation, quantity });
const book = z.object({ instrumentUid: z.string(), orderbookTs: z.iso.datetime({ offset: true }),
  bids: z.array(level).min(1).max(50), asks: z.array(level).min(1).max(50) });
const trading = z.object({ instrumentUid: z.string(), tradingStatus: z.literal('SECURITY_TRADING_STATUS_NORMAL_TRADING'),
  apiTradeAvailableFlag: z.literal(true), limitOrderAvailableFlag: z.literal(true) });
const asNano = (p: z.infer<typeof quotation>) => BigInt(p.units) * scale + BigInt(p.nano);

// Mark the whole remaining lot quantity across available BID depth. A last
// trade, candle close or one liquid best bid is not a liquidation valuation.
export function sandboxBidValue(payload: unknown, status: unknown, instrumentId: string, lots: number, lotSize: number, now: Date) {
  try {
    if (!Number.isSafeInteger(lots) || lots <= 0 || lots > 1_000_000 || !Number.isSafeInteger(lotSize) || lotSize <= 0 || lotSize > 1_000_000) throw new Error();
    const b = book.parse(payload); const s = trading.parse(status);
    const age = now.getTime() - Date.parse(b.orderbookTs);
    if (b.instrumentUid !== instrumentId || s.instrumentUid !== instrumentId || !Number.isFinite(age) || age < -1_000 || age > 15_000) throw new Error();
    for (const [levels, descending] of [[b.bids, true], [b.asks, false]] as const) {
      let previous: bigint | null = null;
      for (const item of levels) {
        const price = asNano(item.price);
        if (price <= 0n || (previous !== null && (descending ? price >= previous : price <= previous))) throw new Error();
        previous = price;
      }
    }
    if (asNano(b.bids[0]!.price) > asNano(b.asks[0]!.price)) throw new Error();
    let remaining = BigInt(lots); let value = 0n; let worstBid = 0n;
    for (const item of b.bids) {
      const filled = remaining < BigInt(item.quantity) ? remaining : BigInt(item.quantity);
      value += filled * BigInt(lotSize) * asNano(item.price); remaining -= filled; worstBid = asNano(item.price);
      if (!remaining) break;
    }
    if (remaining) throw new Error();
    return { grossNano: String(value), quoteAt: b.orderbookTs, worstBidNano: String(worstBid) };
  } catch { throw new Error('Executable sandbox BID depth or freshness is not confirmed'); }
}

function expense(notional: bigint, rate: number): bigint {
  const nanoRate = rate === 0 ? 0n : BigInt(decimalPriceNano(rate));
  const denominator = scale * kopek;
  return ((notional * nanoRate + denominator - 1n) / denominator) * kopek;
}

export function sandboxMarkedTradeLoss(entry: SandboxOrderSnapshot, exit: SandboxOrderSnapshot | null, bidGrossNano: string,
  lotSize: number, commissionRate: number, slippageRate: number) {
  if (!entry.terminal || entry.lotsExecuted <= 0 || entry.commissionNano === null || !/^\d{1,40}$/.test(bidGrossNano)
    || commissionRate < 0.003 || commissionRate > 0.1 || slippageRate < 0 || slippageRate > 0.02) throw new Error('Incomplete sandbox open-loss evidence');
  // Validate the BUY amounts even when there has been no SELL yet.
  const zeroExit: SandboxOrderSnapshot = { brokerOrderId: 'unexecuted-mark-only', executionStatus: 'EXECUTION_REPORT_STATUS_NEW',
    lotsExecuted: 0, terminal: false, grossNano: '0', commissionNano: '0', stages: [] };
  const partial = analyzeSandboxRoundTrip(entry, exit ?? zeroExit, lotSize);
  if (partial.remainingLots <= 0 || (exit && exit.commissionNano === null)) throw new Error('Incomplete sandbox open-loss evidence');
  const marked = BigInt(bidGrossNano); if (marked <= 0n) throw new Error('Incomplete sandbox open-loss evidence');
  const forecastExitCosts = expense(marked, commissionRate) + expense(marked, slippageRate);
  // Actual virtual entry/partial-sale fees, forecast fees/slippage only on the
  // still-unsold quantity. Completed actual sales never get slippage deducted twice.
  const net = BigInt(exit?.grossNano ?? '0') + marked - BigInt(entry.grossNano)
    - BigInt(entry.commissionNano) - BigInt(exit?.commissionNano ?? '0') - forecastExitCosts;
  return { netIfLiquidatedNano: String(net), lossNano: String(net < 0n ? -net : 0n), remainingLots: partial.remainingLots };
}

export function moscowLossDay(now: Date): string {
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid loss day');
  return new Date(now.getTime() + 3 * 60 * 60_000).toISOString().slice(0, 10);
}

// Positive trades never replenish a conservative loss allowance. Overnight
// unresolved positions are marked separately; their basis does not reset at midnight.
export function sandboxClosedDayLoss(results: Array<{ complete: boolean; closedAt: string | null; netPnlNano: string | null }>, now: Date): bigint {
  const day = moscowLossDay(now); let loss = 0n;
  for (const result of results) {
    if (!result.complete || !result.closedAt || result.netPnlNano === null || !/^-?\d{1,40}$/.test(result.netPnlNano)) throw new Error('Incomplete sandbox closed-loss evidence');
    if (moscowLossDay(new Date(result.closedAt)) === day) {
      const net = BigInt(result.netPnlNano); if (net < 0n) loss -= net;
    }
  }
  return loss;
}

export type SandboxLossAssessment = {
  status: 'ok' | 'incomplete' | 'limit'; checkedAt: string; day: string;
  closedLossNano: string | null; openLossNano: string | null; maxTradeLossNano: string | null;
};
export type SandboxLossProof = SandboxLossAssessment & { proofId: string; accountId: string; ledgerRevision: string };
