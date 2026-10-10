import { readFileSync, writeFileSync } from 'node:fs';
import { assertFrozenPaperEtfSnapshots } from './research/paper-daily-frozen-source.js';
import { digest } from './research/verified-candles.js';
import { alignThree, simulateDualMomentumThree } from './research/dual-momentum-three.js';
import { buyAndHoldLqdt } from './research/weekly-lqdt-carry.js';

const protocolSha256 = digest(readFileSync('docs/SBMX_SBGB_SBMM_DUAL_MOMENTUM_V1.md'));
if (protocolSha256 !== 'ae2cf3071ebf41fe6359d80803c41808c9bbaa0dfdb127298297d2700d0611fc') {
  throw new Error('Frozen SBMX/SBGB/SBMM dual-momentum protocol changed');
}
const { sbmx: sbmxSource, sbgb: sbgbSource, sbmm: sbmmSource } = assertFrozenPaperEtfSnapshots();

const aligned = alignThree(sbmxSource.rows, sbgbSource.rows, sbmmSource.rows);
for (const year of [2022, 2023, 2024, 2025]) {
  const count = aligned.sbmx.filter((bar) => bar.day.startsWith(String(year))).length;
  if (count < 150 || count > 400) throw new Error(`Aligned coverage outside 150-400 for ${year}: ${count}`);
}

function book(from: string, thru: string) {
  const overlay = simulateDualMomentumThree({
    sbmx: sbmxSource.rows,
    tgld: sbgbSource.rows,
    sbmm: sbmmSource.rows,
    from,
    thru,
  });
  return {
    from,
    thru,
    overlay,
    sbmxHold: buyAndHoldLqdt(aligned.sbmx, from, thru).endingLiquidationValue,
    sbgbHold: buyAndHoldLqdt(aligned.tgld, from, thru).endingLiquidationValue,
    sbmmHold: buyAndHoldLqdt(aligned.sbmm, from, thru).endingLiquidationValue,
  };
}

const probe = simulateDualMomentumThree({
  sbmx: sbmxSource.rows,
  tgld: sbgbSource.rows,
  sbmm: sbmmSource.rows,
  from: '2021-01-01',
  thru: '2025-12-31',
});
if (!probe.firstSignalDay) throw new Error('No dual-momentum signal day');
const year2022 = probe.firstSignalDay <= '2022-12-31'
  ? book(probe.firstSignalDay < '2022-01-01' ? '2022-01-01' : probe.firstSignalDay, '2022-12-31')
  : null;
const years = [
  book('2023-01-01', '2023-12-31'),
  book('2024-01-01', '2024-12-31'),
  book('2025-01-01', '2025-12-31'),
];
const combined = book(probe.firstSignalDay, '2025-12-31');
const reasons: string[] = [];
if (year2022 === null) reasons.push('unobserved-2022');
else if (year2022.overlay.endingLiquidationValue <= 1_000_000) reasons.push('negative-year-2022');
if (combined.overlay.endingLiquidationValue <= combined.sbmxHold) reasons.push('inferior-to-sbmx-buy-and-hold');
if (combined.overlay.endingLiquidationValue <= combined.sbgbHold) reasons.push('inferior-to-sbgb-buy-and-hold');
if (combined.overlay.endingLiquidationValue <= combined.sbmmHold) reasons.push('inferior-to-sbmm-cash-sleeve');
if (combined.overlay.maxDrawdownPct <= -25) reasons.push('drawdown-at-least-25pct');
for (const year of years) {
  if (year.overlay.endingLiquidationValue <= 1_000_000) {
    reasons.push(`negative-year-${year.from.slice(0, 4)}`);
  }
}
const report = {
  experiment: 'sbmx-sbgb-sbmm-dual-momentum-v1',
  protocolSha256,
  sbmxSourceSha256: sbmxSource.rowsSha256,
  sbgbSourceSha256: sbgbSource.rowsSha256,
  sbmmSourceSha256: sbmmSource.rowsSha256,
  firstSignalDay: probe.firstSignalDay,
  year2022,
  years,
  combined,
  status: reasons.length ? 'not-admitted' : 'requires-execution-and-rights-audit-not-tradeable',
  reasons,
};
writeFileSync('.trading/sbmx-sbgb-sbmm-dual-momentum-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
const summary = (period: typeof combined) => ({
  from: period.from,
  thru: period.thru,
  switches: period.overlay.switches,
  firstSignalDay: period.overlay.firstSignalDay,
  overlayEnding: period.overlay.endingLiquidationValue,
  maxDrawdownPct: period.overlay.maxDrawdownPct,
  sbmxHold: period.sbmxHold,
  sbgbHold: period.sbgbHold,
  sbmmHold: period.sbmmHold,
});
console.log(JSON.stringify({
  experiment: report.experiment,
  protocolSha256,
  firstSignalDay: probe.firstSignalDay,
  year2022: year2022 ? summary(year2022) : null,
  years: years.map(summary),
  combined: summary(combined),
  status: report.status,
  reasons,
}, null, 2));
