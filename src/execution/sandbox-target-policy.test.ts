import { describe, expect, it } from 'vitest';
import type { SandboxOrderSnapshot } from './sandbox-order-state.js';
import { analyzeSandboxRoundTrip } from './sandbox-round-trip.js';
import { assertSandboxTargetProof, sandboxTargetEconomics, sandboxTargetModelNet, type SandboxTargetInput } from './sandbox-target-policy.js';

const invalid = 'Sandbox target economics or proof is invalid';
const entryAt = '2026-10-01T07:50:00Z'; const exitAt = '2026-10-01T07:55:00Z';
function fill(priceNano = '10000000000', lots = 5, lotSize = 10, commissionNano = '2000000000'): SandboxOrderSnapshot {
  return { brokerOrderId: 'synthetic-buy', executionStatus: 'EXECUTION_REPORT_STATUS_FILL', terminal: true,
    lotsExecuted: lots, grossNano: String(BigInt(priceNano) * BigInt(lots) * BigInt(lotSize)), commissionNano,
    stages: [{ tradeId: 'synthetic-buy-fill', lots, priceNano, executedAt: entryAt }] };
}
function sale(priceNano = '11000000000', commissionNano = '1000000000'): SandboxOrderSnapshot {
  const result = fill(priceNano, 5, 10, commissionNano);
  return { ...result, brokerOrderId: 'synthetic-sell', stages: result.stages.map(stage => ({ ...stage, tradeId: 'synthetic-sell-fill', executedAt: exitAt })) };
}
const input: SandboxTargetInput = { lotSize: 10, targetNano: '11000000000', stopNano: '9800000000', tickNano: '100000000',
  commissionRateNano: '3000000', slippageRateNano: '500000' };

describe('Exact conservative sandbox target economics', () => {
  it('matches independent ruble/kopek amounts, including actual fees above the floor', () => {
    // BUY 500 + 2 fee + .25 slip; target 550 - 1.65 fee - .28 slip;
    // stop 490 - 1.47 fee - .25 slip. Reward 45.82 >= 2 * risk 13.97.
    expect(sandboxTargetEconomics(fill(), input)).toEqual({ ...input, version: 1, lots: 5,
      entryGrossNano: '500000000000', entryCommissionNano: '2000000000',
      modelEntryCostsNano: '502250000000', modelTargetProceedsNano: '548070000000',
      modelStopProceedsNano: '488280000000', netTargetNano: '45820000000', netRiskNano: '13970000000' });
  });
  it('charges a minimum commission even when sandbox explicitly reports zero fees', () => {
    const proof = sandboxTargetEconomics(fill('10000000000', 5, 10, '0'), input)!;
    expect(proof.entryCommissionNano).toBe('0'); expect(proof.modelEntryCostsNano).toBe('501750000000');
    expect(proof.netTargetNano).toBe('46320000000'); expect(proof.netRiskNano).toBe('13470000000');
  });
  it('accepts a terminal canceled partially-filled BUY using only executed lots', () => {
    const partial = { ...fill('10000000000', 2, 10, '0'), executionStatus: 'EXECUTION_REPORT_STATUS_CANCELLED' as const };
    const proof = sandboxTargetEconomics(partial, input)!;
    expect(proof.lots).toBe(2); expect(proof.entryGrossNano).toBe('200000000000');
    expect(proof.modelEntryCostsNano).toBe('200700000000'); expect(proof.netTargetNano).toBe('18530000000');
    expect(proof.netRiskNano).toBe('5390000000');
  });
  it('uses every complete unique fill stage and validates its monetary sum', () => {
    const entry = { ...fill(), grossNano: '503000000000', stages: [
      { tradeId: 'synthetic-first', lots: 2, priceNano: '10000000000', executedAt: entryAt },
      { tradeId: 'synthetic-second', lots: 3, priceNano: '10100000000', executedAt: entryAt },
    ] };
    expect(sandboxTargetEconomics(entry, input)!.entryGrossNano).toBe('503000000000');
  });
  it('ceil-rounds each fee/slippage separately even for nanoruble prices', () => {
    const nanoInput = { ...input, lotSize: 3, targetNano: '4000000000', stopNano: '3300000000', tickNano: '1' };
    const proof = sandboxTargetEconomics(fill('3333333333', 1, 3, '1'), nanoInput)!;
    // Entry gross 9.999999999; minimum fee .03, slip .01; target net proceeds 11.95; stop 9.86.
    expect(proof.entryCommissionNano).toBe('1'); expect(proof.modelEntryCostsNano).toBe('10039999999');
    expect(proof.modelTargetProceedsNano).toBe('11950000000'); expect(proof.modelStopProceedsNano).toBe('9860000000');
    expect(proof.netTargetNano).toBe('1910000001'); expect(proof.netRiskNano).toBe('179999999');
  });
  it('rounds reported fees above the minimum up rather than rounding a real expense away', () => {
    expect(sandboxTargetEconomics(fill('10000000000', 5, 10, '2000000001'), input)!.modelEntryCostsNano).toBe('502260000000');
  });
  it('tests the exact 2:1 boundary without floating ratios or rounded displays', () => {
    const entry = fill('1000000000', 1, 1, '0');
    const boundary = { ...input, lotSize: 1, targetNano: '1260000000', stopNano: '900000000', tickNano: '1', slippageRateNano: '0' };
    const proof = sandboxTargetEconomics(entry, boundary)!;
    expect(proof.netTargetNano).toBe('240000000'); expect(proof.netRiskNano).toBe('120000000');
    expect(sandboxTargetEconomics(entry, { ...boundary, targetNano: '1259999999' })).toBeNull();
    expect(sandboxTargetEconomics(entry, { ...boundary, targetNano: '1260000001' })!.netTargetNano).toBe('240000001');
  });
  it('returns null for economic rejection: loss-making target, insufficient reward or high actual fees', () => {
    expect(sandboxTargetEconomics(fill(), { ...input, targetNano: '10010000000', tickNano: '10000000' })).toBeNull();
    expect(sandboxTargetEconomics(fill(), { ...input, targetNano: '10200000000' })).toBeNull();
    expect(sandboxTargetEconomics(fill('10000000000', 5, 10, '60000000000'), input)).toBeNull();
  });
  it('handles maximum safe lot counts and price bounds without a Number money product', () => {
    const large = { ...input, lotSize: 1_000_000, targetNano: '1000000000000000', stopNano: '899000000000000',
      tickNano: '1000000000', slippageRateNano: '0' };
    const proof = sandboxTargetEconomics(fill('900000000000000', 1_000_000, 1_000_000, '0'), large)!;
    expect(proof.modelEntryCostsNano).toBe('902700000000000000000000000');
    expect(proof.netTargetNano).toBe('94300000000000000000000000');
    expect(proof.netRiskNano).toBe('6397000000000000000000000');
  });
  it.each(['3000000', '100000000'])('accepts inclusive commission policy boundary %s', commissionRateNano => {
    expect(() => sandboxTargetEconomics(fill(), { ...input, commissionRateNano })).not.toThrow();
  });
  it.each(['0', '20000000'])('accepts inclusive slippage policy boundary %s', slippageRateNano => {
    expect(() => sandboxTargetEconomics(fill(), { ...input, slippageRateNano })).not.toThrow();
  });
  it.each([
    { lotSize: 0 }, { lotSize: 1.5 }, { lotSize: 1_000_001 }, { lotSize: Number.NaN },
    { targetNano: '0' }, { stopNano: '-1' }, { tickNano: '0' }, { targetNano: '1000000000000001' },
    { tickNano: '1000000000000001' }, { targetNano: '11000000001' }, { stopNano: '9800000001' },
    { targetNano: '10000000000' }, { stopNano: '10000000000' }, { targetNano: '9000000000' },
    { commissionRateNano: '2999999' }, { commissionRateNano: '100000001' }, { commissionRateNano: '-1' },
    { slippageRateNano: '20000001' }, { slippageRateNano: '-1' }, { slippageRateNano: '0.5' },
    { commissionRateNano: '03000000' }, { targetNano: '010000000000' }, { stopNano: 'secret-invalid-value' },
    { targetNano: 11_000_000_000 }, { slippageRateNano: undefined }, { commissionRateNano: '9'.repeat(41) },
  ])('rejects malformed or unsafe input with one fixed message: %j', changes => {
    expect(() => sandboxTargetEconomics(fill(), { ...input, ...changes } as SandboxTargetInput)).toThrow(invalid);
  });
  it.each(['unknown-fees', 'negative-fee', 'noncanonical-fee', 'no-fills', 'nonterminal', 'terminal-flag', 'new-with-fills',
    'gross', 'missing-stage', 'duplicate-stage', 'fractional-lots', 'zero-stage-price', 'price-bound', 'tick', 'stage-time', 'numeric-gross'])
    ('rejects unconfirmed or malformed entry %s with a generic message', condition => {
      const entry = fill();
      if (condition === 'unknown-fees') entry.commissionNano = null;
      if (condition === 'negative-fee') entry.commissionNano = '-1';
      if (condition === 'noncanonical-fee') entry.commissionNano = '00';
      if (condition === 'no-fills') { entry.lotsExecuted = 0; entry.grossNano = '0'; entry.stages = []; }
      if (condition === 'nonterminal') { entry.terminal = false; entry.executionStatus = 'EXECUTION_REPORT_STATUS_PARTIALLYFILL'; }
      if (condition === 'terminal-flag') entry.terminal = false;
      if (condition === 'new-with-fills') { entry.terminal = false; entry.executionStatus = 'EXECUTION_REPORT_STATUS_NEW'; }
      if (condition === 'gross') entry.grossNano = '1';
      if (condition === 'missing-stage') entry.stages = [];
      if (condition === 'duplicate-stage') entry.stages = [entry.stages[0]!, entry.stages[0]!];
      if (condition === 'fractional-lots') entry.stages[0]!.lots = 0.5;
      if (condition === 'zero-stage-price') entry.stages[0]!.priceNano = '0';
      if (condition === 'price-bound') { entry.stages[0]!.priceNano = '1000000000000001'; entry.grossNano = '50000000000000050'; }
      if (condition === 'tick') { entry.stages[0]!.priceNano = '10000000001'; entry.grossNano = '500000000050'; }
      if (condition === 'stage-time') entry.stages[0]!.executedAt = 'secret-invalid-time';
      if (condition === 'numeric-gross') entry.grossNano = 500_000_000_000 as unknown as string;
      expect(() => sandboxTargetEconomics(entry, input)).toThrow(invalid);
    });
});

describe('Fresh canonical sandbox target proofs', () => {
  it('accepts a fresh proof and an equivalent persisted JSON proof', () => {
    const entry = fill(); const proof = sandboxTargetEconomics(entry, input)!;
    expect(() => assertSandboxTargetProof(proof, entry, input)).not.toThrow();
    expect(() => assertSandboxTargetProof(JSON.parse(JSON.stringify(proof)), entry, input)).not.toThrow();
  });
  it('rejects late actual fees even when the minimum fee keeps modeled money unchanged', () => {
    const entry = fill('10000000000', 5, 10, '0'); const proof = sandboxTargetEconomics(entry, input)!;
    const later = { ...entry, commissionNano: '1' };
    expect(sandboxTargetEconomics(later, input)!.modelEntryCostsNano).toBe(proof.modelEntryCostsNano);
    expect(() => assertSandboxTargetProof(proof, later, input)).toThrow(invalid);
  });
  it('rejects stale fill totals, core metadata, or cost evidence', () => {
    const entry = fill(); const proof = sandboxTargetEconomics(entry, input)!;
    expect(() => assertSandboxTargetProof(proof, fill('10100000000'), input)).toThrow(invalid);
    for (const changes of [{ lotSize: 1 }, { targetNano: '11200000000' }, { stopNano: '9700000000' }, { tickNano: '1' }]) {
      expect(() => assertSandboxTargetProof(proof, entry, { ...input, ...changes })).toThrow(invalid);
    }
    expect(() => assertSandboxTargetProof(proof, { ...entry, commissionNano: null }, input)).toThrow(invalid);
  });
  it('rejects any altered, extra or missing canonical key', () => {
    const entry = fill(); const proof = sandboxTargetEconomics(entry, input)!;
    for (const key of Object.keys(proof)) {
      const altered = { ...proof, [key]: 'secret-forged-value' };
      expect(() => assertSandboxTargetProof(altered, entry, input)).toThrow(invalid);
      const missing = { ...proof } as Record<string, unknown>; delete missing[key];
      expect(() => assertSandboxTargetProof(missing, entry, input)).toThrow(invalid);
    }
    expect(() => assertSandboxTargetProof({ ...proof, extra: 'secret-extra' }, entry, input)).toThrow(invalid);
    expect(() => assertSandboxTargetProof({ ...proof, [Symbol('extra')]: true }, entry, input)).toThrow(invalid);
    expect(() => assertSandboxTargetProof({ ...proof, entryGrossNano: '0500000000000' }, entry, input)).toThrow(invalid);
  });
  it.each([null, undefined, [], 'secret-invalid-proof', 1, {}])('does not expose malformed proof details', proof => {
    expect(() => assertSandboxTargetProof(proof, fill(), input)).toThrow(invalid);
  });
});

describe('Separate actual and conservative modeled closed results', () => {
  it('does not double-count actual and minimum fees while retaining a separate virtual actual net', () => {
    const entry = fill(); const exit = sale();
    expect(analyzeSandboxRoundTrip(entry, exit, 10).netPnlNano).toBe('47000000000');
    expect(sandboxTargetModelNet(entry, exit, 10, '3000000', '500000')).toBe('45820000000');
    expect(sandboxTargetModelNet(entry, sale('11000000000', '3000000000'), 10, '3000000', '0')).toBe('45000000000');
  });
  it('rounds each reported expense up and does not treat losses as zero', () => {
    expect(sandboxTargetModelNet(fill('10000000000', 5, 10, '2000000001'), sale('11000000000', '3000000001'),
      10, '3000000', '0')).toBe('44980000000');
    expect(sandboxTargetModelNet(fill(), sale('9800000000', '0'), 10, '3000000', '500000')).toBe('-13970000000');
  });
  it.each(['partial', 'nonterminal', 'unknown-entry-fee', 'unknown-exit-fee', 'reused-fill', 'early-exit', 'wrong-gross', 'floor'])
    ('never derives a complete modeled net from %s', condition => {
      const entry = fill(); const exit = sale();
      if (condition === 'partial') { exit.lotsExecuted = 2; exit.stages[0]!.lots = 2; exit.grossNano = '220000000000'; exit.executionStatus = 'EXECUTION_REPORT_STATUS_CANCELLED'; }
      if (condition === 'nonterminal') { exit.terminal = false; exit.executionStatus = 'EXECUTION_REPORT_STATUS_PARTIALLYFILL'; }
      if (condition === 'unknown-entry-fee') entry.commissionNano = null;
      if (condition === 'unknown-exit-fee') exit.commissionNano = null;
      if (condition === 'reused-fill') exit.stages[0]!.tradeId = entry.stages[0]!.tradeId;
      if (condition === 'early-exit') exit.stages[0]!.executedAt = '2026-10-01T07:49:59Z';
      if (condition === 'wrong-gross') exit.grossNano = '1';
      expect(() => sandboxTargetModelNet(entry, exit, 10, condition === 'floor' ? '2999999' : '3000000', '0')).toThrow(invalid);
    });
});
