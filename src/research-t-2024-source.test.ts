import { describe, expect, it } from 'vitest';
import { t2024DaySpecs } from './research-t-2024-source.js';

describe('T 2024 same-security source schedule', () => {
  it('starts at Russian-share relisting and changes ticker on the exchange date', () => {
    const specs = t2024DaySpecs();
    expect(specs[0]).toEqual({ date: '2024-03-18', ticker: 'TCSG' });
    expect(specs.find((item) => item.date === '2024-11-27')?.ticker).toBe('TCSG');
    expect(specs.find((item) => item.date === '2024-11-28')?.ticker).toBe('T');
    expect(specs.at(-1)?.date).toBe('2024-12-31');
    expect(new Set(specs.map((item) => item.date)).size).toBe(specs.length);
  });
});
