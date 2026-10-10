import { z } from 'zod/v4';
import { decimalPriceNano } from './sandbox-stop-state.js';

const instrument = z.object({ instrument: z.object({ uid: z.string(), instrumentType: z.literal('share'),
  currency: z.string().transform(s => s.toLowerCase()).pipe(z.literal('rub')), lot: z.number().int().positive().max(1_000_000),
  apiTradeAvailableFlag: z.literal(true), sellAvailableFlag: z.literal(true), buyAvailableFlag: z.boolean().optional(),
  minPriceIncrement: z.object({ units: z.string().regex(/^\d{1,12}$/).default('0'), nano: z.number().int().min(0).max(999999999).default(0) }),
}) });

// Closing support is currently restricted to RUB shares, consistent with the
// exclusive-position parser. Never BUY an unsupported ETF/future first and
// discover that its lot size/type cannot be protected or closed afterwards.
export function assertSandboxInstrument(payload: unknown, expected: {instrumentId:string;lotSize:number;priceStep:number}, entry = false) {
  try {
    const i = instrument.parse(payload).instrument;
    const tick = BigInt(i.minPriceIncrement.units) * 1_000_000_000n + BigInt(i.minPriceIncrement.nano);
    if (i.uid !== expected.instrumentId || i.lot !== expected.lotSize || tick !== BigInt(decimalPriceNano(expected.priceStep))
      || (entry && i.buyAvailableFlag !== true)) throw new Error();
  } catch { throw new Error('Broker RUB-share identity, lot size, price tick or API permissions are not confirmed'); }
}
