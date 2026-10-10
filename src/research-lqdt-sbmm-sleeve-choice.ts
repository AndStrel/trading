import { readFileSync, writeFileSync } from 'node:fs';
import { digest } from './research/verified-candles.js';
import { auditWeeklyPortfolio } from './research/weekly-portfolio-risk.js';
import { buyAndHoldLqdt } from './research/weekly-lqdt-carry.js';
import { alignWeekdayBars } from './research/sbgb-sbmm-relative-lag.js';
import type { DailyBar } from './research/weekly-trend.js';

const protocolSha256 = digest(readFileSync('docs/LQDT_SBMM_SLEEVE_CHOICE_V1.md'));
if (protocolSha256 !== '641312070a76330ac306be8fb6ffcacc33d5bea682e0460224834dc7c0815747') {
  throw new Error('Frozen LQDT/SBMM sleeve-choice protocol changed');
}
const lqdtSource = JSON.parse(readFileSync('.trading/lqdt-daily-2022-2025.json', 'utf8')) as {
  rowsSha256: string;
  rows: DailyBar[];
};
const sbmmSource = JSON.parse(readFileSync('.trading/sbmm-daily-2021-2025.json', 'utf8')) as {
  rowsSha256: string;
  rows: DailyBar[];
};
if (lqdtSource.rowsSha256 !== '30735af9d50b40756b1dcb0446671c61cb0f265d6aa3e2efff59dc8e72b5d519') {
  throw new Error('Frozen LQDT source changed');
}
if (sbmmSource.rowsSha256 !== '6a70207aa52c48b620597cacadaab117de9d858711a1fae5047f2f075b88eca3') {
  throw new Error('Frozen SBMM source changed');
}

function book(rows: DailyBar[], from: string, thru: string) {
  const hold = buyAndHoldLqdt(rows, from, thru);
  const bars = rows.filter((bar) => bar.day >= from && bar.day <= thru);
  const portfolio = auditWeeklyPortfolio(
    bars,
    [
      {
        entryDay: hold.entryDay,
        exitDay: hold.finalDay,
        entry: hold.entry,
        principal: 1_000_000,
        proceeds: hold.endingLiquidationValue,
      },
    ],
    [],
    hold.endingLiquidationValue,
  );
  return { ending: hold.endingLiquidationValue, maxDrawdownPct: portfolio.maxDrawdownPct, entryDay: hold.entryDay, finalDay: hold.finalDay };
}

const aligned = alignWeekdayBars(lqdtSource.rows, sbmmSource.rows);
const from = '2022-07-22';
const thru = '2025-12-30';
const lqdt = book(aligned.left, from, thru);
const sbmm = book(aligned.right, from, thru);
const eligible = [
  { ticker: 'LQDT' as const, ...lqdt },
  { ticker: 'SBMM' as const, ...sbmm },
].filter((row) => row.maxDrawdownPct > -5);
let chosen: 'LQDT' | 'SBMM' | null = null;
let rule = 'none-eligible-keep-lqdt-default';
if (eligible.length === 1) {
  chosen = eligible[0]!.ticker;
  rule = 'only-eligible';
} else if (eligible.length === 2) {
  const [a, b] = eligible;
  const larger = Math.max(a!.ending, b!.ending);
  if (Math.abs(a!.ending - b!.ending) < 0.01 * larger) {
    chosen = a!.maxDrawdownPct >= b!.maxDrawdownPct ? a!.ticker : b!.ticker;
    rule = 'endings-within-1pct-milder-drawdown';
  } else {
    chosen = a!.ending >= b!.ending ? a!.ticker : b!.ticker;
    rule = 'higher-ending';
  }
}
const report = {
  experiment: 'lqdt-sbmm-sleeve-choice-v1',
  protocolSha256,
  lqdtSourceSha256: lqdtSource.rowsSha256,
  sbmmSourceSha256: sbmmSource.rowsSha256,
  alignedDays: aligned.left.filter((bar) => bar.day >= from && bar.day <= thru).length,
  from,
  thru,
  lqdt,
  sbmm,
  chosen,
  rule,
  status: chosen ? 'default-ticker-selected' : 'keep-lqdt-default',
};
writeFileSync('.trading/lqdt-sbmm-sleeve-choice-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({
  experiment: report.experiment,
  protocolSha256,
  alignedDays: report.alignedDays,
  lqdt,
  sbmm,
  chosen,
  rule,
  status: report.status,
}, null, 2));
