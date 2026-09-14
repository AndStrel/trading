export type Quotation = {
  units?: string | number;
  nano?: number;
};

export function quotationToNumber(value: Quotation | undefined): number | null {
  if (!value) return null;
  const units = Number(value.units ?? 0);
  const nano = value.nano ?? 0;
  if (!Number.isFinite(units) || !Number.isFinite(nano)) return null;
  return units + nano / 1_000_000_000;
}

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
