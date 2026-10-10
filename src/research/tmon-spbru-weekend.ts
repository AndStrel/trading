export function weekendTickReturn(entry: number, exit: number, adverseTicksPerSide: number): number {
  if (![entry, exit].every((value) => Number.isFinite(value) && value > 0) ||
      !Number.isSafeInteger(adverseTicksPerSide) || adverseTicksPerSide < 0 ||
      Math.abs(entry * 100 - Math.round(entry * 100)) > 1e-6 ||
      Math.abs(exit * 100 - Math.round(exit * 100)) > 1e-6) {
    throw new Error('Invalid SPBRU TMON print or tick allowance');
  }
  const buyCents = Math.round(entry * 100) + adverseTicksPerSide;
  const sellCents = Math.round(exit * 100) - adverseTicksPerSide;
  if (sellCents <= 0) throw new Error('Adverse sale price is nonpositive');
  return sellCents / buyCents - 1;
}
