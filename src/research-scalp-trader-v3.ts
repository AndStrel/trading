import { readFileSync, writeFileSync } from 'node:fs';
import { digest } from './research/verified-candles.js';
import { simulateScalp } from './research/scalp-trader.js';
import { scalpGateReasons } from './research/scalp-trader.js';
import { simulateHourlyHold } from './research/scalp-trader-v2.js';
import { readCachedT2024Day, t2024DaySpecs } from './research-t-2024-source.js';
import { readCachedTDay, t2025Weekdays } from './research-t-2025-source.js';
import type { HistoricalMinuteCandle as Candle } from './history/market-data-store.js';
import type { SiCandle } from './research/si-first-hour.js';

const protocolSha256 = digest(readFileSync('docs/SCALP_TRADER_V3.md'));
if (protocolSha256 !== '4ce0d1b4d9c05678ba255bdec12a061314932b0e083dc1636064b3819d237ba5') throw new Error('Frozen scalp v3 protocol changed');

function asCandle(instrumentId: string, candle: SiCandle): Candle {
  return { instrumentId, time: `${candle.time.replace(' ', 'T')}+03:00`, open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume };
}

const candles2024 = t2024DaySpecs().flatMap((spec) => readCachedT2024Day(spec).candles.map((candle) => asCandle(spec.ticker, candle)));
const candles2025 = t2025Weekdays().flatMap((date) => readCachedTDay(date).candles.map((candle) => asCandle('T', candle)));
const clockHours = [11, 12, 13, 14, 15, 16];
const continuationBounds = { sessionEnd: '16:55', lastSignal: '16:39' };

function summarize(kind: string, parts: { trades: { day: string; netPct: number; stressPct: number }[]; unresolved: string[]; sessionDays: number }[]) {
  const trades = parts.flatMap((part) => part.trades);
  const unresolved = parts.reduce((sum, part) => sum + part.unresolved.length, 0);
  const sessionDays = parts.reduce((sum, part) => sum + part.sessionDays, 0);
  const mean = (year?: number) => {
    const sample = year === undefined ? trades : trades.filter((item) => item.day.startsWith(String(year)));
    return sample.length === 0 ? null : sample.reduce((sum, item) => sum + item.netPct, 0) / sample.length;
  };
  return {
    kind,
    trades: trades.length,
    unresolved,
    sessionDays,
    tradesPerSessionDay: sessionDays === 0 ? null : trades.length / sessionDays,
    winRate: trades.length === 0 ? null : trades.filter((item) => item.netPct > 0).length / trades.length,
    meanNetPct: mean(),
    meanStressPct: trades.length === 0 ? null : trades.reduce((sum, item) => sum + item.stressPct, 0) / trades.length,
    mean2024: mean(2024),
    mean2025: mean(2025),
    reasons: scalpGateReasons(trades, sessionDays, unresolved),
  };
}

const rules = [
  summarize('hourly-continuation', [
    simulateHourlyHold('T', candles2024, 'hourly-continuation', clockHours),
    simulateHourlyHold('T', candles2025, 'hourly-continuation', clockHours),
  ]),
  summarize('hourly-fade', [
    simulateHourlyHold('T', candles2024, 'hourly-fade', clockHours),
    simulateHourlyHold('T', candles2025, 'hourly-fade', clockHours),
  ]),
  summarize('five-minute-continuation', [
    simulateScalp('T', candles2024, 'five-minute-continuation', continuationBounds),
    simulateScalp('T', candles2025, 'five-minute-continuation', continuationBounds),
  ]),
].map((rule) => ({ ...rule, status: rule.reasons.length === 0 ? 'not-tradeable-pending-audit' : 'not-admitted' }));

const report = { experiment: 'scalp-trader-v3-t', protocolSha256, tariff: 'trader-before-subscription', rules };
writeFileSync('.trading/scalp-trader-v3.json', JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify(report, null, 2));
