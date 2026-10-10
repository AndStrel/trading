import { readFileSync, writeFileSync } from 'node:fs';
import { digest } from './research/verified-candles.js';
import { simulateSbmxSbmmSma60 } from './research/sbmx-sbmm-sma60-overlay.js';
import { buyAndHoldLqdt } from './research/weekly-lqdt-carry.js';
import { alignWeekdayBars } from './research/sbgb-sbmm-relative-lag.js';
import type { DailyBar } from './research/weekly-trend.js';

const protocolSha256 = digest(readFileSync('docs/SBMX_SBMM_SMA60_OVERLAY_V1.md'));
if (protocolSha256 !== 'aa9881cdc30f99116cac4d31c20602e2aff6a51f549e17d4bf281c9ad0bc44bb') {
  throw new Error('Frozen SBMX/SBMM SMA60 overlay protocol changed');
}
const sbmxSource = JSON.parse(readFileSync('.trading/sbmx-daily-2021-2025.json', 'utf8')) as {
  rowsSha256: string;
  rows: DailyBar[];
  coverage?: { year: number; count: number }[];
};
const sbmmSource = JSON.parse(readFileSync('.trading/sbmm-daily-2021-2025.json', 'utf8')) as {
  rowsSha256: string;
  rows: DailyBar[];
};
if (sbmxSource.rowsSha256 !== '5f1f0e533a4bfc05d88014b3052245ffb55b430faebb9a23289521672effe64b') {
  throw new Error('Frozen SBMX source changed');
}
if (sbmmSource.rowsSha256 !== '6a70207aa52c48b620597cacadaab117de9d858711a1fae5047f2f075b88eca3') {
  throw new Error('Frozen SBMM source changed');
}

const aligned = alignWeekdayBars(sbmxSource.rows, sbmmSource.rows);
const warmup = aligned.left.filter((bar) => bar.day < '2022-01-01').length;
if (warmup < 60) throw new Error('Insufficient 2021 warmup for SMA60');
for (const year of [2022, 2023, 2024, 2025]) {
  const count = aligned.left.filter((bar) => bar.day.startsWith(String(year))).length;
  if (count < 150 || count > 400) throw new Error(`Aligned coverage outside 150-400 for ${year}: ${count}`);
}

function book(from: string, thru: string) {
  const overlay = simulateSbmxSbmmSma60({
    sbmx: sbmxSource.rows,
    sbmm: sbmmSource.rows,
    from,
    thru,
  });
  return {
    from,
    thru,
    overlay,
    sbmxHold: buyAndHoldLqdt(aligned.left, from, thru).endingLiquidationValue,
    sbmmHold: buyAndHoldLqdt(aligned.right, from, thru).endingLiquidationValue,
  };
}

const years = [
  book('2022-01-01', '2022-12-31'),
  book('2023-01-01', '2023-12-31'),
  book('2024-01-01', '2024-12-31'),
  book('2025-01-01', '2025-12-31'),
];
const combined = book('2022-01-01', '2025-12-31');
const reasons: string[] = [];
if (combined.overlay.endingLiquidationValue <= combined.sbmxHold) reasons.push('inferior-to-sbmx-buy-and-hold');
if (combined.overlay.endingLiquidationValue <= combined.sbmmHold) reasons.push('inferior-to-sbmm-cash-sleeve');
if (combined.overlay.maxDrawdownPct <= -25) reasons.push('drawdown-at-least-25pct');
for (const year of years) {
  if (year.overlay.endingLiquidationValue <= 1_000_000) {
    reasons.push(`negative-year-${year.from.slice(0, 4)}`);
  }
}
const report = {
  experiment: 'sbmx-sbmm-sma60-overlay-v1',
  protocolSha256,
  sbmxSourceSha256: sbmxSource.rowsSha256,
  sbmmSourceSha256: sbmmSource.rowsSha256,
  alignedDays: aligned.left.length,
  warmupDaysBefore2022: warmup,
  years,
  combined,
  status: reasons.length ? 'not-admitted' : 'requires-execution-and-rights-audit-not-tradeable',
  reasons,
};
writeFileSync('.trading/sbmx-sbmm-sma60-overlay-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
const summary = (period: typeof combined) => ({
  from: period.from,
  thru: period.thru,
  switches: period.overlay.switches,
  overlayEnding: period.overlay.endingLiquidationValue,
  maxDrawdownPct: period.overlay.maxDrawdownPct,
  sbmxHold: period.sbmxHold,
  sbmmHold: period.sbmmHold,
});
console.log(JSON.stringify({
  experiment: report.experiment,
  protocolSha256,
  alignedDays: aligned.left.length,
  warmupDaysBefore2022: warmup,
  years: years.map(summary),
  combined: summary(combined),
  status: report.status,
  reasons,
}, null, 2));
