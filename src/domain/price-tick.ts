export const MAX_SUPPORTED_PRICE = 1_000_000;
const NANOS_PER_RUBLE = 1_000_000_000n;

// Decimal input is represented as a rational before tick rounding. Floating
// division/multiplication must not introduce a second, non-exchange price step.
function nanorubleRatio(value: number): { numerator: bigint; denominator: bigint } {
  if (!Number.isFinite(value) || value < 0 || value > MAX_SUPPORTED_PRICE) {
    throw new Error('Price must be finite and between zero and one million rubles');
  }
  const [mantissa = '', exponent = '0'] = String(value).toLowerCase().split('e');
  const [whole = '', fraction = ''] = mantissa.split('.');
  const digits = BigInt(whole + fraction);
  const shift = 9 + Number(exponent) - fraction.length;
  return shift >= 0
    ? { numerator: digits * 10n ** BigInt(shift), denominator: 1n }
    : { numerator: digits, denominator: 10n ** BigInt(-shift) };
}

/** Validate a positive, exact nanoruble price or tick without silently truncating it. */
export function priceToNano(value: number): bigint {
  const ratio = nanorubleRatio(value);
  if (value <= 0 || ratio.numerator % ratio.denominator !== 0n) {
    throw new Error('Price must be positive and use at most nanoruble precision');
  }
  return ratio.numerator / ratio.denominator;
}

function canonicalPrice(nano: bigint): number {
  if (nano === 0n) return 0;
  const whole = nano / NANOS_PER_RUBLE;
  const fraction = String(nano % NANOS_PER_RUBLE).padStart(9, '0');
  const value = Number(`${whole}.${fraction}`);
  if (priceToNano(value) !== nano) throw new Error('Rounded price cannot be represented exactly');
  return value;
}

/** Round the decimal numeric input in the requested direction using exact tick counts. */
export function roundPriceToTick(value: number, priceStep: number, direction: 'floor' | 'ceil'): number {
  const tick = priceToNano(priceStep);
  const ratio = nanorubleRatio(value);
  const denominator = ratio.denominator * tick;
  const ticks = direction === 'ceil'
    ? (ratio.numerator + denominator - 1n) / denominator
    : ratio.numerator / denominator;
  return canonicalPrice(ticks * tick);
}
