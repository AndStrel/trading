export type Quotation = {
  units?: string | number;
  nano?: number;
};

export function numberToQuotation(value: number): Required<Quotation> {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('Quotation value must be a finite number greater than zero');
  }

  const units = Math.floor(value);
  const nano = Math.round((value - units) * 1_000_000_000);
  if (nano === 1_000_000_000) {
    return { units: String(units + 1), nano: 0 };
  }
  return { units: String(units), nano };
}

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
