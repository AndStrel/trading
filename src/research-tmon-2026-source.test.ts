import { describe, expect, it } from 'vitest';
import { tmon2026Board, tmon2026Weekdays } from './research-tmon-2026-source.js';

describe('TMON 2026 fixed source scope', () => {
  it('switches board at the published migration date', () => {
    expect(tmon2026Board('2026-06-19')).toBe('TQTF');
    expect(tmon2026Board('2026-06-22')).toBe('TQBR');
  });
  it('uses only weekdays through the frozen cutoff', () => {
    const days = tmon2026Weekdays();
    expect(days[0]).toBe('2026-01-01');
    expect(days.at(-1)).toBe('2026-09-25');
    expect(days.every((day) => ![0, 6].includes(new Date(`${day}T00:00:00Z`).getUTCDay()))).toBe(true);
  });
});
