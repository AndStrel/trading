import { readFileSync, writeFileSync } from 'node:fs';
import { digest } from './research/verified-candles.js';
import { alignThree, simulateDualMomentumThree } from './research/dual-momentum-three.js';
import { buyAndHoldLqdt } from './research/weekly-lqdt-carry.js';
import type { DailyBar } from './research/weekly-trend.js';

const protocolSha256 = digest(readFileSync('docs/SBMX_TGLD_SBMM_DUAL_MOMENTUM_V1.md'));
if (protocolSha256 !== '57d80b013f72d034ac781d3183e447c7117915258fe4217a5b211958040d81b7') {
  throw new Error('Frozen dual-momentum protocol changed');
}
const sbmxSource = JSON.parse(readFileSync('.trading/sbmx-daily-2021-2025.json', 'utf8')) as {
  rowsSha256: string;
  rows: DailyBar[];
};
const tgldSource = JSON.parse(readFileSync('.trading/tgld-daily-2022-2025.json', 'utf8')) as {
  rowsSha256: string;
  rows: DailyBar[];
};
const sbmmSource = JSON.parse(readFileSync('.trading/sbmm-daily-2021-2025.json', 'utf8')) as {
  rowsSha256: string;
  rows: DailyBar[];
};
if (sbmxSource.rowsSha256 !== '5f1f0e533a4bfc05d88014b3052245ffb55b430faebb9a23289521672effe64b') {
  throw new Error('Frozen SBMX source changed');
}
if (tgldSource.rowsSha256 !== '347575ab305338bcc9408be815366a5c12f37b164c10a5e08bf024a5e653ca2f') {
  throw new Error('Frozen TGLD source changed');
}
if (sbmmSource.rowsSha256 !== '6a70207aa52c48b620597cacadaab117de9d858711a1fae5047f2f075b88eca3') {
  throw new Error('Frozen SBMM source changed');
}

const aligned = alignThree(sbmxSource.rows, tgldSource.rows, sbmmSource.rows);
for (const year of [2023, 2024, 2025]) {
  const count = aligned.sbmx.filter((bar) => bar.day.startsWith(String(year))).length;
  if (count < 150 || count > 400) throw new Error(`Aligned coverage outside 150-400 for ${year}: ${count}`);
}

function book(from: string, thru: string) {
  const overlay = simulateDualMomentumThree({
    sbmx: sbmxSource.rows,
    tgld: tgldSource.rows,
    sbmm: sbmmSource.rows,
    from,
    thru,
  });
  return {
    from,
    thru,
    overlay,
    sbmxHold: buyAndHoldLqdt(aligned.sbmx, from, thru).endingLiquidationValue,
    tgldHold: buyAndHoldLqdt(aligned.tgld, from, thru).endingLiquidationValue,
    sbmmHold: buyAndHoldLqdt(aligned.sbmm, from, thru).endingLiquidationValue,
  };
}

const probe = simulateDualMomentumThree({
  sbmx: sbmxSource.rows,
  tgld: tgldSource.rows,
  sbmm: sbmmSource.rows,
  from: '2022-01-01',
  thru: '2025-12-31',
});
if (!probe.firstSignalDay) throw new Error('No dual-momentum signal day');
const year2022 = probe.firstSignalDay.startsWith('2022')
  ? book(probe.firstSignalDay, '2022-12-31')
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
if (combined.overlay.endingLiquidationValue <= combined.tgldHold) reasons.push('inferior-to-tgld-buy-and-hold');
if (combined.overlay.endingLiquidationValue <= combined.sbmmHold) reasons.push('inferior-to-sbmm-cash-sleeve');
if (combined.overlay.maxDrawdownPct <= -25) reasons.push('drawdown-at-least-25pct');
for (const year of years) {
  if (year.overlay.endingLiquidationValue <= 1_000_000) {
    reasons.push(`negative-year-${year.from.slice(0, 4)}`);
  }
}
const report = {
  experiment: 'sbmx-tgld-sbmm-dual-momentum-v1',
  protocolSha256,
  sbmxSourceSha256: sbmxSource.rowsSha256,
  tgldSourceSha256: tgldSource.rowsSha256,
  sbmmSourceSha256: sbmmSource.rowsSha256,
  firstSignalDay: probe.firstSignalDay,
  year2022,
  years,
  combined,
  status: reasons.length ? 'not-admitted' : 'requires-execution-and-rights-audit-not-tradeable',
  reasons,
};
writeFileSync('.trading/sbmx-tgld-sbmm-dual-momentum-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
const summary = (period: typeof combined) => ({
  from: period.from,
  thru: period.thru,
  switches: period.overlay.switches,
  firstSignalDay: period.overlay.firstSignalDay,
  overlayEnding: period.overlay.endingLiquidationValue,
  maxDrawdownPct: period.overlay.maxDrawdownPct,
  sbmxHold: period.sbmxHold,
  tgldHold: period.tgldHold,
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
