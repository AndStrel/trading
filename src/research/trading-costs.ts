export type Costs = { commission: number; slippage: number };
function validate(costs: Costs) {
  if (![costs.commission, costs.slippage].every((v) => Number.isFinite(v) && v >= 0 && v < 1)) throw new Error('Invalid costs');
}
export function eventReturnPct(entry: number, exit: number, costs: Costs) {
  validate(costs);
  if (![entry, exit].every((v) => Number.isFinite(v) && v > 0)) throw new Error('Invalid price');
  return (exit * (1 - costs.slippage) * (1 - costs.commission) /
    (entry * (1 + costs.slippage) * (1 + costs.commission)) - 1) * 100;
}
export function breakEvenGrossPct(costs: Costs) {
  validate(costs);
  return ((1 + costs.slippage) * (1 + costs.commission) / ((1 - costs.slippage) * (1 - costs.commission)) - 1) * 100;
}
export const costScenarios = {
  gross: { commission: 0, slippage: 0 },
  investorFeeOnly: { commission: 0.003, slippage: 0 },
  investorBase: { commission: 0.003, slippage: 0.0005 },
  investorStress: { commission: 0.003, slippage: 0.001 },
  investorExtreme: { commission: 0.003, slippage: 0.0015 },
  traderBeforeSubscription: { commission: 0.0005, slippage: 0.0005 },
} satisfies Record<string, Costs>;
