import type { SandboxOrderSnapshot } from './sandbox-order-state.js';
import { analyzeSandboxRoundTrip } from './sandbox-round-trip.js';

const scale = 1_000_000_000n;
const kopek = 10_000_000n;
const maxPrice = 1_000_000n * scale;
const invalid = 'Sandbox target economics or proof is invalid';

export type SandboxTargetCore = {
  lotSize: number; targetNano: string; stopNano: string; tickNano: string;
};
export type SandboxTargetInput = SandboxTargetCore & {
  commissionRateNano: string; slippageRateNano: string;
};
export type SandboxTargetProof = SandboxTargetInput & {
  version: 1; lots: number; entryGrossNano: string; entryCommissionNano: string;
  modelEntryCostsNano: string; modelTargetProceedsNano: string; modelStopProceedsNano: string;
  netTargetNano: string; netRiskNano: string;
};

function unsigned(value: unknown): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,39})$/.test(value)) throw new Error(invalid);
  return BigInt(value);
}
function price(value: unknown): bigint {
  const amount = unsigned(value);
  if (amount <= 0n || amount > maxPrice) throw new Error(invalid);
  return amount;
}
function rates(commission: string, slippage: string) {
  const fee = unsigned(commission); const slip = unsigned(slippage);
  if (fee < 3_000_000n || fee > 100_000_000n || slip > 20_000_000n) throw new Error(invalid);
  return { fee, slip };
}
function ceilKopeks(amount: bigint): bigint { return ((amount + kopek - 1n) / kopek) * kopek; }
function expense(gross: bigint, rate: bigint): bigint {
  const denominator = scale * kopek;
  return ((gross * rate + denominator - 1n) / denominator) * kopek;
}
function modeledFee(gross: bigint, actual: bigint, rate: bigint): bigint {
  const reported = ceilKopeks(actual); const floor = expense(gross, rate);
  return reported > floor ? reported : floor;
}
function validateAmounts(snapshot: SandboxOrderSnapshot, tick?: bigint): void {
  unsigned(snapshot.grossNano); unsigned(snapshot.commissionNano);
  if (!Array.isArray(snapshot.stages) || snapshot.stages.length > 10_000) throw new Error(invalid);
  for (const stage of snapshot.stages) {
    const value = price(stage.priceNano);
    if (tick !== undefined && value % tick !== 0n) throw new Error(invalid);
  }
}
function validateEntry(entry: SandboxOrderSnapshot, lotSize: number): void {
  // Reuse the existing complete/unique stage, terminal fill and gross validator
  // without claiming a SELL occurred or making a broker/journal request.
  const zeroExit: SandboxOrderSnapshot = {
    brokerOrderId: entry.brokerOrderId === 'sandbox-target-zero-exit' ? 'sandbox-target-zero-exit-other' : 'sandbox-target-zero-exit',
    executionStatus: 'EXECUTION_REPORT_STATUS_NEW', terminal: false,
    lotsExecuted: 0, grossNano: '0', commissionNano: '0', stages: [],
  };
  analyzeSandboxRoundTrip(entry, zeroExit, lotSize);
}

export function sandboxTargetEconomics(entry: SandboxOrderSnapshot, input: SandboxTargetInput): SandboxTargetProof | null {
  try {
    const { fee, slip } = rates(input.commissionRateNano, input.slippageRateNano);
    const target = price(input.targetNano); const stop = price(input.stopNano); const tick = price(input.tickNano);
    if (target % tick !== 0n || stop % tick !== 0n) throw new Error(invalid);
    validateEntry(entry, input.lotSize); validateAmounts(entry, tick);
    const units = BigInt(entry.lotsExecuted) * BigInt(input.lotSize);
    const entryGross = unsigned(entry.grossNano); const entryCommission = unsigned(entry.commissionNano);
    const targetGross = target * units; const stopGross = stop * units;
    if (targetGross <= entryGross || stopGross >= entryGross) throw new Error(invalid);
    const entryCosts = entryGross + modeledFee(entryGross, entryCommission, fee) + expense(entryGross, slip);
    const targetProceeds = targetGross - expense(targetGross, fee) - expense(targetGross, slip);
    const stopProceeds = stopGross - expense(stopGross, fee) - expense(stopGross, slip);
    const netTarget = targetProceeds - entryCosts; const netRisk = entryCosts - stopProceeds;
    if (netTarget <= 0n || netTarget < 2n * netRisk) return null;
    return {
      version: 1, lotSize: input.lotSize, targetNano: String(target), stopNano: String(stop), tickNano: String(tick),
      commissionRateNano: String(fee), slippageRateNano: String(slip), lots: entry.lotsExecuted,
      entryGrossNano: String(entryGross), entryCommissionNano: String(entryCommission),
      modelEntryCostsNano: String(entryCosts), modelTargetProceedsNano: String(targetProceeds),
      modelStopProceedsNano: String(stopProceeds), netTargetNano: String(netTarget), netRiskNano: String(netRisk),
    };
  } catch { throw new Error(invalid); }
}

export function assertSandboxTargetProof(proof: unknown, entry: SandboxOrderSnapshot, core: SandboxTargetCore): void {
  try {
    if (!proof || typeof proof !== 'object' || Array.isArray(proof)) throw new Error(invalid);
    const recorded = proof as Record<string, unknown>;
    const expected = sandboxTargetEconomics(entry, { ...core,
      commissionRateNano: recorded.commissionRateNano as string, slippageRateNano: recorded.slippageRateNano as string });
    if (!expected || Object.getOwnPropertyNames(recorded).length !== Object.keys(expected).length
      || Object.getOwnPropertySymbols(recorded).length !== 0
      || Object.entries(expected).some(([key, value]) => !Object.hasOwn(recorded, key) || recorded[key] !== value)) {
      throw new Error(invalid);
    }
  } catch { throw new Error(invalid); }
}

// Separate from actual virtual PnL: conservative modeled fees replace, never
// supplement, actual fees. Modeled slippage is deliberately charged both sides.
export function sandboxTargetModelNet(entry: SandboxOrderSnapshot, exit: SandboxOrderSnapshot, lotSize: number,
  commissionRateNano: string, slippageRateNano: string): string {
  try {
    const { fee, slip } = rates(commissionRateNano, slippageRateNano);
    const result = analyzeSandboxRoundTrip(entry, exit, lotSize);
    validateAmounts(entry); validateAmounts(exit);
    if (!result.fullySold || result.netPnlNano === null) throw new Error(invalid);
    const bought = unsigned(entry.grossNano); const sold = unsigned(exit.grossNano);
    return String(sold - bought - modeledFee(bought, unsigned(entry.commissionNano), fee)
      - modeledFee(sold, unsigned(exit.commissionNano), fee) - expense(bought, slip) - expense(sold, slip));
  } catch { throw new Error(invalid); }
}
