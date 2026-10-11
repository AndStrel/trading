import { costScenarios, eventReturnPct, type Costs } from './trading-costs.js';
import type { PatternTrade } from './candle-pattern.js';
import type { DailyBar } from './weekly-trend.js';

const traderStress: Costs = { commission: 0.0005, slippage: 0.001 };
const from = '2024-01-01';
const thru = '2025-12-30';

function ordered(input: readonly DailyBar[]): DailyBar[] {
  const bars = [...input].filter((bar) => bar.day <= thru);
  if (bars.some((bar, index) => !Number.isFinite(bar.volume) || bar.volume < 0 || !Number.isFinite(bar.open) || bar.open <= 0 ||
    !Number.isFinite(bar.close) || bar.close <= 0 || (index > 0 && bar.day <= bars[index - 1]!.day))) {
    throw new Error('Invalid daily bars');
  }
  return bars;
}

function trade(bar: DailyBar, pattern: string): PatternTrade {
  return {
    day: bar.day,
    pattern,
    netPct: eventReturnPct(bar.open, bar.close, costScenarios.traderBeforeSubscription),
    stressPct: eventReturnPct(bar.open, bar.close, traderStress),
  };
}

export function simulateVolumePatterns(input: readonly DailyBar[]): PatternTrade[] {
  const bars = ordered(input);
  const trades: PatternTrade[] = [];
  for (let index = 21; index < bars.length; index += 1) {
    const bar = bars[index]!;
    if (bar.day < from) continue;
    const volumes = bars.slice(index - 21, index - 1).map((item) => item.volume).sort((a, b) => a - b);
    const median = (volumes[9]! + volumes[10]!) / 2;
    trades.push(trade(bar, bars[index - 1]!.volume > median ? 'H' : 'L'));
  }
  return trades;
}

export function simulateAgreement(target: readonly DailyBar[], left: readonly DailyBar[], right: readonly DailyBar[]): PatternTrade[] {
  const byDay = (bars: readonly DailyBar[]) => new Map(ordered(bars).map((bar) => [bar.day, bar]));
  const others = byDay(left);
  const peers = byDay(right);
  const trades: PatternTrade[] = [];
  const bars = ordered(target);
  for (let index = 1; index < bars.length; index += 1) {
    const bar = bars[index]!;
    const priorDay = bars[index - 1]!.day;
    if (bar.day < from) continue;
    const a = others.get(priorDay);
    const b = peers.get(priorDay);
    if (!a || !b) continue;
    const upA = a.close >= a.open;
    const upB = b.close >= b.open;
    const pattern = upA === upB ? (upA ? 'UU' : 'DD') : 'X';
    trades.push(trade(bar, pattern));
  }
  return trades;
}
