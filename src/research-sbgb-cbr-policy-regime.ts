import { readFileSync, writeFileSync } from 'node:fs';
import { digest } from './research/verified-candles.js';
import { CBR_DECISION_DATES, CBR_UNSCHEDULED_DECISION_DATES } from './research/cbr-sber-reaction.js';
import { simulateSbgbCbrPolicyRegime } from './research/sbgb-cbr-policy-regime.js';
import { buyAndHoldLqdt } from './research/weekly-lqdt-carry.js';
import { alignWeekdayBars } from './research/sbgb-sbmm-relative-lag.js';
import type { DailyBar } from './research/weekly-trend.js';

const protocolSha256 = digest(readFileSync('docs/SBGB_CBR_POLICY_REGIME_V1.md'));
if (protocolSha256 !== 'a5e400cf6779e59d7506a35c5d7e310ed12462db02ae55508115f4b04069b8bd') {
  throw new Error('Frozen SBGB CBR policy-regime protocol changed');
}
const ratesSource = JSON.parse(readFileSync('.trading/cbr-keyrate-2015-2025.json', 'utf8')) as {
  rowsSha256: string;
  rates: { day: string; rate: number }[];
};
const sbgbSource = JSON.parse(readFileSync('.trading/sbgb-daily-2021-2025.json', 'utf8')) as {
  rowsSha256: string;
  rows: DailyBar[];
};
const sbmmSource = JSON.parse(readFileSync('.trading/sbmm-daily-2021-2025.json', 'utf8')) as {
  rowsSha256: string;
  rows: DailyBar[];
};
if (ratesSource.rowsSha256 !== '91da3d92eaef46b4631f2504aee49dc47aa6520b05681e221b9aa35c90d82620') {
  throw new Error('Frozen CBR key-rate series changed');
}
if (sbgbSource.rowsSha256 !== 'ea9f54cd20cbb14f65fc98656bb9cae23a1df23b35a4bb044304ffb53cc1a36a') {
  throw new Error('Frozen SBGB source changed');
}
if (sbmmSource.rowsSha256 !== '6a70207aa52c48b620597cacadaab117de9d858711a1fae5047f2f075b88eca3') {
  throw new Error('Frozen SBMM source changed');
}

const scheduled = CBR_DECISION_DATES.filter((day) => day >= '2021-01-01' && day <= '2025-12-31');
const unscheduled = CBR_UNSCHEDULED_DECISION_DATES.filter((day) => day >= '2021-01-01' && day <= '2025-12-31');
const aligned = alignWeekdayBars(sbgbSource.rows, sbmmSource.rows);

function book(from: string, thru: string) {
  const overlay = simulateSbgbCbrPolicyRegime({
    sbgb: sbgbSource.rows,
    sbmm: sbmmSource.rows,
    rates: ratesSource.rates,
    scheduled,
    unscheduled,
    from,
    thru,
  });
  return {
    from,
    thru,
    overlay,
    sbgbHold: buyAndHoldLqdt(aligned.left, from, thru).endingLiquidationValue,
    sbmmHold: buyAndHoldLqdt(aligned.right, from, thru).endingLiquidationValue,
  };
}

const discovery = book('2021-01-01', '2023-12-31');
const validation = book('2024-01-01', '2025-12-31');
const combined = book('2021-01-01', '2025-12-31');
const year2022 = book('2022-01-01', '2022-12-31');
const reasons: string[] = [];
if (combined.overlay.endingLiquidationValue <= combined.sbgbHold) reasons.push('inferior-to-sbgb-buy-and-hold');
if (combined.overlay.endingLiquidationValue <= combined.sbmmHold) reasons.push('inferior-to-sbmm-cash-sleeve');
if (combined.overlay.maxDrawdownPct <= -25) reasons.push('drawdown-at-least-25pct');
if (year2022.overlay.endingLiquidationValue <= 1_000_000) reasons.push('negative-year-2022');
if (discovery.overlay.endingLiquidationValue <= discovery.sbmmHold) reasons.push('discovery-inferior-to-sbmm');
if (validation.overlay.endingLiquidationValue <= validation.sbmmHold) reasons.push('validation-inferior-to-sbmm');
const report = {
  experiment: 'sbgb-cbr-policy-regime-v1',
  protocolSha256,
  rateSha256: ratesSource.rowsSha256,
  sbgbSourceSha256: sbgbSource.rowsSha256,
  sbmmSourceSha256: sbmmSource.rowsSha256,
  discovery,
  validation,
  combined,
  year2022,
  status: reasons.length ? 'not-admitted' : 'requires-execution-and-rights-audit-not-tradeable',
  reasons,
};
writeFileSync('.trading/sbgb-cbr-policy-regime-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
const summary = (period: typeof discovery) => ({
  from: period.from,
  thru: period.thru,
  switches: period.overlay.switches,
  overlayEnding: period.overlay.endingLiquidationValue,
  maxDrawdownPct: period.overlay.maxDrawdownPct,
  sbgbHold: period.sbgbHold,
  sbmmHold: period.sbmmHold,
});
console.log(JSON.stringify({
  experiment: report.experiment,
  protocolSha256,
  discovery: summary(discovery),
  validation: summary(validation),
  combined: summary(combined),
  year2022: summary(year2022),
  status: report.status,
  reasons,
}, null, 2));
