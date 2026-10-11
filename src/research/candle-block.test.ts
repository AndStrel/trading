import { describe, expect, it } from 'vitest';
import { simulateBlocks } from './candle-block.js';
import type { DailyBar } from './weekly-trend.js';

function bar(day: string, open: number, close: number): DailyBar {
  return { day, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
}

describe('five-session blocks', () => {
  it('buys the next block after a rising signal block', () => {
    const signal = Array.from({ length: 15 }, (_, index) => bar(`2024-01-${String(index + 10).padStart(2, '0')}`, 10, index < 5 ? 10 + index : 20));
    const target = signal.map((item, index) => bar(item.day, 100 + index, 100 + index));
    const trades = simulateBlocks(signal, target, 'imoex');
    expect(trades[0]).toMatchObject({ day: '2024-01-15', pattern: 'imoex-U' });
  });
});
