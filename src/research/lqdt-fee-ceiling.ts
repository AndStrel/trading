export function oracleLongNetFromDailyRange(low: number, high: number, feePerSide: number): number {
  if (![low, high, feePerSide].every(Number.isFinite) || low <= 0 || high < low ||
      feePerSide < 0 || feePerSide >= 1) throw new Error('Invalid daily range or fee');
  return high * (1 - feePerSide) / (low * (1 + feePerSide)) - 1;
}
