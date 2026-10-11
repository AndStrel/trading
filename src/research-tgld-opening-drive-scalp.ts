import { readFileSync, writeFileSync } from 'node:fs';
import { digest } from './research/verified-candles.js';
import { openingDriveGateReasons, simulateOpeningDrive } from './research/tgld-opening-drive-scalp.js';
import { readCachedTgld2025Day, tgld2025Weekdays } from './research-tgld-2025-source.js';
import type { HistoricalMinuteCandle as Candle } from './history/market-data-store.js';

const protocolSha256 = digest(readFileSync('docs/TGLD_OPENING_DRIVE_SCALP_V1.md'));
if (protocolSha256 !== 'f91957251dcf34a716bcf529b15c5296fcc23cbd8c539c93aa03d9cd3e51f263') throw new Error('Frozen TGLD opening-drive protocol changed');

const candles: Candle[] = tgld2025Weekdays().flatMap((date) => readCachedTgld2025Day(date).candles.map((candle) => ({
  instrumentId: 'TGLD',
  time: `${candle.time.replace(' ', 'T')}+03:00`,
  open: candle.open,
  high: candle.high,
  low: candle.low,
  close: candle.close,
  volume: candle.volume,
})));
const result = simulateOpeningDrive(candles);
const mean = (values: number[]) => values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
const reasons = openingDriveGateReasons(result.trades, result.sessionDays, result.unresolved.length);
const report = {
  experiment: 'tgld-opening-drive-scalp-v1',
  protocolSha256,
  tariff: 'trader-before-subscription',
  year: 2025,
  trades: result.trades.length,
  unresolved: result.unresolved.length,
  sessionDays: result.sessionDays,
  tradesPerSessionDay: result.sessionDays === 0 ? null : result.trades.length / result.sessionDays,
  winRate: result.trades.length === 0 ? null : result.trades.filter((trade) => trade.netPct > 0).length / result.trades.length,
  meanNetPct: mean(result.trades.map((trade) => trade.netPct)),
  meanStressPct: mean(result.trades.map((trade) => trade.stressPct)),
  reasons,
  status: reasons.length === 0 ? 'discovery-only-not-tradeable' : 'not-admitted',
};
writeFileSync('.trading/tgld-opening-drive-scalp-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify(report, null, 2));
