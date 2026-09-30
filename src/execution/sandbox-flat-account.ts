import { z } from 'zod/v4';

const cash = z.object({ currency: z.string().transform(s => s.toLowerCase()).pipe(z.literal('rub')),
  units: z.string().regex(/^\d{1,12}$/), nano: z.number().int().min(0).max(999_999_999) });
const flat = z.object({ accountId: z.string(), limitsLoadingInProgress: z.literal(false),
  securities: z.array(z.unknown()).length(0), futures: z.array(z.unknown()).length(0), options: z.array(z.unknown()).length(0),
  money: z.array(cash).length(1), blocked: z.array(cash) });

export function sandboxFlatCashNano(payload: unknown, accountId: string): bigint {
  try {
    const p = flat.parse(payload); if (p.accountId !== accountId) throw new Error();
    const nano = (value: z.infer<typeof cash>) => BigInt(value.units) * 1_000_000_000n + BigInt(value.nano);
    if (p.blocked.some(value => nano(value) !== 0n)) throw new Error();
    return nano(p.money[0]!);
  } catch { throw new Error('Flat RUB sandbox account is not confirmed'); }
}
export function assertNoSandboxOrders(payload: unknown): void {
  try { z.object({ orders: z.array(z.unknown()).length(0) }).parse(payload); }
  catch { throw new Error('Empty sandbox order book is not confirmed'); }
}
