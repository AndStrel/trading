import { describe, expect, it, vi } from 'vitest';
import * as livePilot from '../execution/live-pilot-risk.js';
import { repriceCatalogTrades, type CatalogModeledTrade } from './catalog-parity-replay.js';
import { validateCatalogCohortViability, type CatalogCohortPolicy } from './catalog-cohort-viability.js';

const RUB = 1_000_000_000n;
const KOPEK = 10_000_000n;
const policy: CatalogCohortPolicy = { capitalRub: 500, commissionRate: 0.003, slippageRate: 0.0005,
  maxTradeRiskRub: 20, maxDailyRiskRub: 60, maxDailyLossRub: 60, maxOrdersPerDay: 3 };
const at = (minute: number, day = '2025-08-04') => new Date(Date.parse(`${day}T00:00:00Z`) + (minute - 180) * 60_000).toISOString();
const nanos = (rub: number) => String(Math.round(rub * 1e9));
const fee = (gross: bigint, numerator: bigint) => ((gross * numerator + RUB * KOPEK - 1n) / (RUB * KOPEK)) * KOPEK;
let sequence = 0;
function trade(options: {
  entryNano?: string; stopNano?: string; targetNano?: string; exitNano?: string;
  entryMinute?: number; exitMinute?: number; date?: string; status?: 'closed' | 'unresolved';
  exitReason?: CatalogModeledTrade['exitReason']; lots?: number; lotSize?: number; id?: string;
} = {}): CatalogModeledTrade {
  const entry = BigInt(options.entryNano ?? nanos(290));
  const stop = BigInt(options.stopNano ?? nanos(275));
  const target = BigInt(options.targetNano ?? nanos(327.5));
  const exit = BigInt(options.exitNano ?? String(target));
  const lots = options.lots ?? 1; const lotSize = options.lotSize ?? 1;
  const units = lots * lotSize; const entryGross = entry * BigInt(units); const exitGross = exit * BigInt(units);
  const entryFee = fee(entryGross, 3_000_000n); const entrySlip = fee(entryGross, 500_000n);
  const exitFee = fee(exitGross, 3_000_000n); const exitSlip = fee(exitGross, 500_000n);
  const stopGross = stop * BigInt(units);
  const status = options.status ?? 'closed';
  const date = options.date ?? '2025-08-04';
  return { id: options.id ?? `synthetic-${sequence++}`, strategyId: 'trend-momentum-v1', ticker: 'TEST', instrumentId: 'public-synthetic-uid',
    sessionDate: date, entryAt: at(options.entryMinute ?? 610, date), exitAt: status === 'closed' ? at(options.exitMinute ?? 611, date) : null,
    unresolvedAt: status === 'unresolved' ? at((options.entryMinute ?? 610) + 2, date) : null,
    status, lots, units, lotSize, entryNano: String(entry), stopNano: String(stop), targetNano: String(target),
    entryGrossNano: String(entryGross), entryCommissionNano: String(entryFee), entrySlippageNano: String(entrySlip),
    exitNano: status === 'closed' ? String(exit) : null, exitGrossNano: status === 'closed' ? String(exitGross) : null,
    exitCommissionNano: status === 'closed' ? String(exitFee) : null, exitSlippageNano: status === 'closed' ? String(exitSlip) : null,
    netNano: status === 'closed' ? String(exitGross - entryGross - entryFee - entrySlip - exitFee - exitSlip) : null,
    reservedRiskNano: String(entryGross - stopGross + entryFee + entrySlip + fee(stopGross, 3_000_000n) + fee(stopGross, 500_000n)),
    exitReason: options.exitReason ?? (status === 'closed' ? 'target-touch' : 'missing-minute'), ambiguousStopFirst: false, executableEvidence: false };
}
function check(original = [trade()], overrides: Partial<CatalogCohortPolicy> = {}) {
  const selected = { ...policy, ...overrides };
  const repriced = repriceCatalogTrades(original, selected).modeledTrades;
  return validateCatalogCohortViability({ originalTrades: original, repricedTrades: repriced, policy: selected });
}
const codes = (result: ReturnType<typeof check>) => result.blockers.map(blocker => blocker.code);

describe('same-cohort modeled cash and risk proof', () => {
  it('matches independent nanoruble/kopeck cash and stop-risk oracles', () => {
    const result = check();
    expect(result).toMatchObject({ pathProven: true, allowed: true, productionCompatible: true,
      cashFeasibilityProven: true, riskLimitsProven: true, endingCashNano: '535320000000',
      openEntryGrossNano: '0', monthlyFeesNano: '0', modeledEntryCount: 1, modeledExitCount: 1 });
    expect(result.accountLedger).toEqual([
      { kind: 'entry', tradeIndex: 0, observedAt: at(610), accepted: true,
        cashBeforeNano: '500000000000', cashChangeNano: '-291020000000', cashAfterNano: '208980000000',
        cashRequiredNano: '291020000000', tradeRiskNano: '16990000000', netTargetNano: '35320000000',
        reservedDailyRiskNano: '16990000000', realizedDailyLossNano: '0', ordersForDay: 1 },
      { kind: 'exit', tradeIndex: 0, observedAt: at(612), accepted: true,
        cashBeforeNano: '208980000000', cashChangeNano: '326340000000', cashAfterNano: '535320000000',
        cashRequiredNano: '0', tradeRiskNano: '0', netTargetNano: '0',
        reservedDailyRiskNano: '16990000000', realizedDailyLossNano: '0', ordersForDay: 1 },
    ]);
    expect(result.admission).toEqual({ allowed: false, executableEvidence: false });
    expect(result.executableEvidence).toBe(false);
    expect(result.researchStatus).toBe('development-only');
  });
  it('recomputes higher-cost risk without trusting the original reserve', () => {
    const original = [trade()];
    const result = check(original, { slippageRate: 0.001 });
    expect(original[0]!.reservedRiskNano).toBe('16990000000');
    expect(result.pathProven).toBe(true);
    expect(result.accountLedger[0]).toMatchObject({ cashRequiredNano: '291160000000',
      tradeRiskNano: '17270000000', reservedDailyRiskNano: '17270000000', netTargetNano: '35020000000' });
    expect(result.endingCashNano).toBe('535020000000');
  });
  it('refuses a profitable same-cohort stress when its entry cash no longer fits', () => {
    const original = [trade({ entryNano: nanos(498.25), stopNano: nanos(485), targetNano: nanos(550) })];
    expect(check(original).pathProven).toBe(true); // Entry498.25 + fee1.50 + slip.25 = exactly500.
    const result = check(original, { slippageRate: 0.001 });
    expect(codes(result)).toContain('cash-insufficient');
    expect(result.pathProven).toBe(false);
    expect(result.accountLedger[0]).toMatchObject({ accepted: false, cashRequiredNano: '500250000000', cashAfterNano: '500000000000' });
    expect(result.modeledEntryCount).toBe(0);
    expect(result.modeledExitCount).toBe(0); // No imaginary exit funding a failed entry.
    expect(result.endingCashNano).toBe('500000000000');
  });
  it('rejects a stressed trade above20 even if gross cash and target profits look attractive', () => {
    const original = [trade({ stopNano: nanos(272), targetNano: nanos(340) })];
    expect(check(original).pathProven).toBe(true);
    const result = check(original, { slippageRate: 0.001 });
    expect(result.accountLedger[0]?.tradeRiskNano).toBe('20260000000');
    expect(codes(result)).toContain('trade-risk-limit');
    expect(codes(result)).toContain('production-risk-gate');
    expect(result.pathProven).toBe(false);
  });
  it('requires net target reward of at least twice the recomputed risk without stretching the target', () => {
    const original = [trade({ targetNano: nanos(326.8) })];
    expect(check(original).pathProven).toBe(true);
    const result = check(original, { slippageRate: 0.001 });
    expect(codes(result)).toContain('net-reward-to-risk');
    expect(result.pathProven).toBe(false);
  });
  it('retains whole lots and exact sub-kopeck prices while rounding each expense upward', () => {
    const original = [trade({ entryNano: '1000000001', stopNano: '900000000', targetNano: '2000000000' })];
    const result = check(original);
    expect(result.pathProven).toBe(true);
    expect(result.accountLedger[0]).toMatchObject({ cashRequiredNano: '1020000001', tradeRiskNano: '140000001', netTargetNano: '959999999' });
    expect(result.endingCashNano).toBe('500959999999');
  });
  it('uses the unchanged production gate for Investor but labels cheaper floors research-only', () => {
    const spy = vi.spyOn(livePilot, 'assessLivePilotRisk');
    try {
      expect(check().pathProven).toBe(true);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]![1].commissionRate).toBe(0.003);
      for (const commissionRate of [0.0005, 0.0003] as const) {
        const result = check([trade()], { commissionRate });
        expect(result.pathProven).toBe(true);
        expect(result.productionCompatible).toBe(false);
        expect(result.admission.allowed).toBe(false);
      }
      expect(spy).toHaveBeenCalledTimes(1);
    } finally { spy.mockRestore(); }
  });
  it('does not allow a shared production-gate refusal to be bypassed by the private oracle', () => {
    const spy = vi.spyOn(livePilot, 'assessLivePilotRisk').mockReturnValue({ allowed: false,
      blockers: ['synthetic-shared-refusal'], positionRub: 290, cashRequiredRub: 291.02, totalRiskRub: 16.99, netRewardRub: 35.32 });
    try { expect(codes(check())).toContain('production-risk-gate'); }
    finally { spy.mockRestore(); }
  });
});

describe('same-cohort event timing and daily reservations', () => {
  it('never uses target/stop-touch proceeds at the start of their OHLC minute', () => {
    const original = [trade({ exitMinute: 615 }), trade({ entryMinute: 615, exitMinute: 616 })];
    const result = check(original, { capitalRub: 1000 });
    expect(codes(result)).toContain('overlapping-position');
    expect(result.accountLedger).toHaveLength(2);
    expect(result.accountLedger[1]).toMatchObject({ kind: 'entry', observedAt: at(615), accepted: false });
    expect(result.modeledExitCount).toBe(0);
  });
  it('checks entries before exits even at the exact +1minute observation tie', () => {
    const original = [trade({ exitMinute: 614 }), trade({ entryMinute: 615, exitMinute: 616 })];
    const result = check(original, { capitalRub: 1000 });
    expect(codes(result)).toContain('overlapping-position');
    expect(result.endingCashNano).toBe('708980000000');
    expect(result.modeledEntryCount).toBe(1);
    expect(result.modeledExitCount).toBe(0);
  });
  it('uses already-observed proceeds later, with unchanged lots and no capital top-up', () => {
    const original = [trade({ exitMinute: 615 }), trade({ entryMinute: 620, exitMinute: 621 })];
    const result = check(original);
    expect(result.pathProven).toBe(true);
    expect(result.endingCashNano).toBe('570640000000');
    expect(result.accountLedger.filter(row => row.kind === 'entry').map(row => row.cashRequiredNano)).toEqual(['291020000000', '291020000000']);
  });
  it('does not expand the original position-capital limit after profits', () => {
    const original = [trade(), trade({ entryMinute: 620, exitMinute: 621,
      entryNano: nanos(530), stopNano: nanos(520), targetNano: nanos(565) })];
    const result = check(original);
    //535.32 cash is known, but the fixed500 position-capital limit remains unchanged.
    expect(codes(result)).toContain('cash-insufficient');
    expect(result.endingCashNano).toBe('535320000000');
    expect(result.modeledEntryCount).toBe(1);
  });
  it('observes the exact18:30 session OPEN and immutable-target-cap exception at that instant', () => {
    const session = trade({ exitMinute: 1110, exitNano: nanos(295), exitReason: 'session-close' });
    expect(check([session]).accountLedger[1]?.observedAt).toBe(at(1110));
    expect(check([session]).endingCashNano).toBe('502940000000');
    const cap = trade({ exitMinute: 1110 });
    expect(check([cap]).accountLedger[1]?.observedAt).toBe(at(1110));
    expect(check([cap]).endingCashNano).toBe('535320000000');
  });
  it('does not replenish cumulative day risk or negative losses with profitable exits', () => {
    const original = [
      trade({ stopNano: nanos(272), targetNano: nanos(340), exitNano: nanos(272), exitReason: 'stop-touch' }),
      trade({ entryMinute: 620, exitMinute: 621, stopNano: nanos(272), targetNano: nanos(340) }),
      trade({ entryMinute: 630, exitMinute: 631, stopNano: nanos(272), targetNano: nanos(340), exitNano: nanos(272), exitReason: 'stop-touch' }),
    ];
    const result = check(original);
    expect(result.pathProven).toBe(true);
    expect(result.accountLedger[3]).toMatchObject({ reservedDailyRiskNano: '39960000000', realizedDailyLossNano: '19980000000' });
    expect(result.accountLedger[5]).toMatchObject({ reservedDailyRiskNano: '59940000000', realizedDailyLossNano: '39960000000' });
  });
  it('rejects a fourth same-day attempt instead of silently selecting three winners', () => {
    const original = [610, 620, 630, 640].map(minute => trade({ entryMinute: minute, exitMinute: minute + 1, stopNano: nanos(272), targetNano: nanos(340) }));
    const result = check(original);
    expect(codes(result)).toContain('max-orders-per-day');
    expect(codes(result)).toContain('daily-risk-limit');
    expect(result.pathProven).toBe(false);
    expect(result.modeledEntryCount).toBe(3);
    expect(result.modeledExitCount).toBe(3);
    expect(result.accountLedger.at(-1)?.accepted).toBe(false);
  });
  it('does not allow the next reserved risk to overrun the remaining daily loss allowance', () => {
    const original = [610, 620, 630, 640].map(minute => trade({ entryMinute: minute, exitMinute: minute + 1,
      stopNano: nanos(272), targetNano: nanos(340), exitNano: nanos(272), exitReason: 'stop-touch' }));
    const result = check(original);
    expect(codes(result)).toContain('daily-loss-limit');
    expect(result.accountLedger.at(-1)?.realizedDailyLossNano).toBe('59940000000');
    expect(result.pathProven).toBe(false);
  });
  it('resets day allowances only when flat and never tops up cash on a new date', () => {
    const original = [trade({ exitNano: nanos(275), exitReason: 'stop-touch' }), trade({ date: '2025-08-05' })];
    const result = check(original);
    expect(result.pathProven).toBe(true);
    expect(result.accountLedger[2]).toMatchObject({ cashBeforeNano: '483010000000', reservedDailyRiskNano: '16990000000', realizedDailyLossNano: '0', ordersForDay: 1 });
  });
  it('unresolved attempts reserve cash/risk, have no proceeds, and permanently fail the proof', () => {
    const original = [trade({ status: 'unresolved' })];
    const result = check(original);
    expect(codes(result)).toContain('unresolved-attempt');
    expect(result.pathProven).toBe(false);
    expect(result.accountLedger).toHaveLength(1);
    expect(result.endingCashNano).toBe('208980000000');
    expect(result.openEntryGrossNano).toBe('290000000000');
    expect(result.modeledExitCount).toBe(0);
    const later = check([...original, trade({ date: '2025-08-05' })], { capitalRub: 1000 });
    expect(codes(later)).toContain('overlapping-position');
    expect(later.accountLedger.at(-1)?.reservedDailyRiskNano).toBe('16990000000');
  });
});

describe('same-cohort monthly billing approximation and safe validation', () => {
  it('debits390 before the first entry, making the500RUB SBER-like path unaffordable', () => {
    const result = check([trade()], { commissionRate: 0.0005, monthlyFeeRub: 390 });
    expect(result.pathProven).toBe(false);
    expect(codes(result)).toContain('cash-insufficient');
    expect(result.accountLedger[0]).toMatchObject({ kind: 'monthly-fee', cashBeforeNano: '500000000000', cashAfterNano: '110000000000' });
    expect(result.accountLedger[1]).toMatchObject({ kind: 'entry', accepted: false, cashRequiredNano: '290300000000', realizedDailyLossNano: '0' });
    expect(result.monthlyFeesNano).toBe('390000000000');
    expect(result.dailyLossScope).toBe('negative-realized-trades-only');
    expect(result.monthlyFeeModel).toBe('calendar-first-entry-before-entry-not-actual-billing');
  });
  it('charges each original calendar-month first entry once and keeps fees out of net-win labels', () => {
    const cheap = (minute: number, date = '2025-08-04') => trade({ entryMinute: minute, exitMinute: minute + 1, date,
      entryNano: nanos(100), stopNano: nanos(95), targetNano: nanos(120) });
    const original = [cheap(610), cheap(620), cheap(630), cheap(610, '2025-09-01')];
    const result = check(original, { capitalRub: 1000, commissionRate: 0.0005, monthlyFeeRub: 390 });
    expect(result.pathProven).toBe(true);
    expect(result.monthlyFeesNano).toBe('780000000000');
    expect(result.accountLedger.filter(row => row.kind === 'monthly-fee')).toHaveLength(2);
    expect(result.endingCashNano).toBe('299120000000'); //1000 +4*(20-.05-.05-.06-.06) -2*390.
    expect(result.admission.allowed).toBe(false);
  });
  it('fails the second month when its service charge itself cannot be paid, without a credit', () => {
    const cheap = (date: string) => trade({ date, entryNano: nanos(100), stopNano: nanos(95), targetNano: nanos(120) });
    const result = check([cheap('2025-08-04'), cheap('2025-09-01')], { commissionRate: 0.0005, monthlyFeeRub: 390 });
    expect(codes(result)).toContain('monthly-fee-insufficient');
    expect(result.monthlyFeesNano).toBe('390000000000');
    expect(result.endingCashNano).toBe('129780000000');
    expect(result.accountLedger.at(-1)).toMatchObject({ kind: 'monthly-fee', accepted: false, cashChangeNano: '0' });
  });
  it('refuses a negative cash balance when rounded exit expenses exceed stop proceeds', () => {
    const stopped = (minute: number, date: string, entry = 19.97) => trade({
      entryMinute: minute, exitMinute: minute + 1, date, entryNano: nanos(entry),
      stopNano: nanos(0.01), targetNano: nanos(61), exitNano: nanos(0.01), exitReason: 'stop-touch',
    });
    const original = [
      ...[610, 620, 630].map(minute => stopped(minute, '2025-08-04')),
      ...[610, 620].map(minute => stopped(minute, '2025-08-05')),
      stopped(630, '2025-08-05', 9.98),
    ];
    //500-390 subscription-5*20 stop losses =10; final entry9.98 +.01+.01 leaves0.
    //Final stop gross.01 minus commission.01 and slippage.01 requires an extra.01, not credit.
    const result = check(original, { commissionRate: 0.0005, monthlyFeeRub: 390 });
    expect(result.pathProven).toBe(false);
    expect(result.allowed).toBe(false);
    expect(result.cashFeasibilityProven).toBe(false);
    expect(codes(result)).toEqual(['exit-expenses-insufficient']);
    expect(result.endingCashNano).toBe('0');
    expect(result.modeledEntryCount).toBe(6);
    expect(result.modeledExitCount).toBe(5);
    expect(result.accountLedger.at(-1)).toMatchObject({ kind: 'exit', tradeIndex: 5, observedAt: at(632, '2025-08-05'),
      accepted: false, cashBeforeNano: '0', cashChangeNano: '0', cashAfterNano: '0', cashRequiredNano: '10000000' });
    expect(result.accountLedger.every(row => BigInt(row.cashAfterNano) >= 0n)).toBe(true);
    expect(result.admission.allowed).toBe(false);
  });
  it('preserves both input arrays and never emits their identifiers or error text', () => {
    const original = [trade({ id: 'private-secret-marker' })]; original[0]!.instrumentId = 'private-uid-marker';
    const repriced = repriceCatalogTrades(original, policy).modeledTrades;
    const snapshot = structuredClone({ original, repriced });
    const result = validateCatalogCohortViability({ originalTrades: original, repricedTrades: repriced, policy });
    expect({ original, repriced }).toEqual(snapshot);
    expect(JSON.stringify(result)).not.toContain('private');
    const malformed = [{ ...original[0]!, entryGrossNano: 'private-token-marker' }];
    const failed = validateCatalogCohortViability({ originalTrades: malformed, repricedTrades: repriced, policy });
    expect(failed.blockers).toEqual([{ code: 'invalid-input', tradeIndex: null, observedAt: null }]);
    expect(failed.endingCashNano).toBeNull();
    expect(JSON.stringify(failed)).not.toContain('private');
  });
  it.each(['stopNano', 'targetNano', 'entryAt', 'lotSize', 'id'])('rejects changed cohort field %s', field => {
    const original = [trade()]; const repriced = repriceCatalogTrades(original, policy).modeledTrades;
    const change = { stopNano: nanos(274), targetNano: nanos(330), entryAt: at(615), lotSize: 2, id: 'different' };
    Object.assign(repriced[0]!, { [field]: change[field as keyof typeof change] });
    const result = validateCatalogCohortViability({ originalTrades: original, repricedTrades: repriced, policy });
    expect(result.pathProven).toBe(false);
    expect(result.blockers.length).toBeGreaterThan(0);
    expect(result.accountLedger).toHaveLength(0);
  });
  it('rejects wrong fees, fabricated net, incomplete exits, duplicate identities and sparse input', () => {
    for (const alteration of [{ entryCommissionNano: '0' }, { netNano: '1' }, { exitNano: null }]) {
      const original = [trade()]; const repriced = repriceCatalogTrades(original, policy).modeledTrades;
      Object.assign(repriced[0]!, alteration);
      expect(validateCatalogCohortViability({ originalTrades: original, repricedTrades: repriced, policy }).pathProven).toBe(false);
    }
    const original = [trade({ id: 'duplicate' }), trade({ id: 'duplicate', entryMinute: 620, exitMinute: 621 })];
    expect(check(original).pathProven).toBe(false);
    expect(validateCatalogCohortViability({ originalTrades: new Array<CatalogModeledTrade>(1), repricedTrades: new Array<CatalogModeledTrade>(1), policy }).pathProven).toBe(false);
  });
  it.each(['2025-07-31', '2026-09-27', '2025-08-03'])('refuses out-of-period/weekend timestamp%s', date => {
    expect(check([trade({ date })]).pathProven).toBe(false);
  });
  it('refuses noncanonical dates, wrong Moscow day, session times and post-close exits', () => {
    for (const alteration of [{ entryAt: '2025-08-04T07:10:00Z' }, { sessionDate: '2025-08-05' },
      { entryAt: at(600) }, { exitAt: at(1111) }, { exitReason: 'session-close' as const }]) {
      const original = [{ ...trade(), ...alteration }];
      expect(validateCatalogCohortViability({ originalTrades: original, repricedTrades: original, policy }).pathProven).toBe(false);
    }
  });
  it('empty, oversized, different-length and altered fixed-policy inputs cannot claim a proven path', () => {
    expect(codes(check([]))).toEqual(['empty-cohort']);
    const original = [trade()];
    expect(validateCatalogCohortViability({ originalTrades: original, repricedTrades: [], policy }).blockers[0]?.code).toBe('cohort-mismatch');
    expect(validateCatalogCohortViability({ originalTrades: new Array<CatalogModeledTrade>(1_000_001), repricedTrades: [], policy }).blockers[0]?.code).toBe('invalid-input');
    expect(check(original, { maxTradeRiskRub: 21 } as unknown as CatalogCohortPolicy).pathProven).toBe(false);
  });
});
