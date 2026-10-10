import { describe, expect, it } from 'vitest';
import { median, mechanismSignals, executeDiscovery, discoveryStats, blockIntervals, type MorningFrame, type DiscoveryTrade } from './mechanism-discovery.js';
const frame = (ticker: string, day: string, ret = 0): MorningFrame => ({ ticker, day, ret, firstRet: 0, rebound: 0.002,
  firstRange: 0.01, firstHigh: 101, lastClose: 102, firstVolume: 100, lastVolume: 50 });
const history = (): [MorningFrame, MorningFrame][] => Array.from({ length: 60 }, (_, i) => {
  const day = new Date(Date.UTC(2023, 0, 1 + i)).toISOString().slice(0, 10);
  return [frame('A', day, (i % 3 - 1) * 0.001), frame('B', day, (i % 5 - 2) * 0.001)];
});
const trade = (day: string, net: number): DiscoveryTrade => ({ ticker: 'A', day, entryAt: '', exitAt: '', entry: 100, exit: 100,
  net, stress: net, trader: net, gross: net, oracleNet: null });
describe('registered mechanism discovery', () => {
  it('uses strictly prior days and correctly maps the three conditions', () => {
    const a = { ...frame('A', '2024-01-03', -0.02), firstRet: -0.01, firstVolume: 300 }, b = frame('B', a.day, 0.01);
    const result = mechanismSignals(a, b, history())!;
    expect(result.signals['relative-lag']).toBe(true);
    expect(result.signals['selling-exhaustion']).toBe(true);
    expect(result.signals['compression-breakout']).toBe(false);
    expect(mechanismSignals(a, b, [...history(), [a, b], [{ ...a, day: '2025-01-01', ret: 99 }, { ...b, day: '2025-01-01' }]])).toEqual(result);
    const compressed = { ...a, firstRange: 0.001, lastVolume: 100 };
    expect(mechanismSignals(compressed, b, history())!.signals['compression-breakout']).toBe(true);
    expect(mechanismSignals(a, b, history().slice(1))).toBeNull();
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
  it('does not manufacture relative signals from a degenerate regression', () => {
    const h = history().map(([a, b]) => [a, { ...b, ret: 0 }] as [MorningFrame, MorningFrame]);
    expect(mechanismSignals(frame('A', '2024-01-01', -10), frame('B', '2024-01-01', 1), h)!.signals['relative-lag']).toBe(false);
  });
  it('separates optimistic future peak from actual exit; incomplete paths have no oracle statistic', () => {
    const f = frame('A', '2024-01-01'); const start = Date.parse('2024-01-01T09:01:00Z');
    const rows = Array.from({ length: 301 }, (_, i) => [start + i * 60000,
      { instrumentId: 'A', time: new Date(start + i * 60000).toISOString(), open: 100, close: 100, high: i === 30 ? 105 : 100, low: 100, volume: 1 }] as const);
    const data = new Map(rows), r = executeDiscovery(f, data);
    expect(r.status).toBe('closed');
    if (r.status !== 'closed') throw Error('Expected closed');
    expect(r.trade.net).toBeLessThan(0); expect(r.trade.oracleNet).toBeGreaterThan(0);
    data.delete(start + 60000); const missing = executeDiscovery(f, data);
    expect(missing.status === 'closed' && missing.trade.oracleNet).toBeNull();
    for (let i = 0; i < 5; i++) data.delete(start + i * 60000);
    expect(executeDiscovery(f, data).status).toBe('cancelled');
  });
  it('51 percent wins can still lose money; zeros are not wins', () => {
    const trades = Array.from({ length: 100 }, (_, i) => trade(String(i), i < 51 ? 1 : -2));
    expect(discoveryStats(trades).winRate).toBe(0.51);
    expect(discoveryStats(trades).meanNetPct).toBeCloseTo(-0.47);
    expect(discoveryStats([trade('a', 0)]).winRate).toBe(0);
  });
  it('bootstraps deterministically by complete date blocks and handles small samples', () => {
    const t = Array.from({ length: 10 }, (_, i) => trade(String(i), 1));
    expect(blockIntervals(t)).toEqual(blockIntervals(t));
    expect(blockIntervals(t)!.meanNetPct).toEqual([1, 1]);
    expect(blockIntervals(t)!.winRate).toEqual([1, 1]);
    expect(blockIntervals(t.slice(0, 4))).toBeNull();
  });
});
