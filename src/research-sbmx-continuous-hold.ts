import { readFileSync, writeFileSync } from 'node:fs';
import { digest } from './research/verified-candles.js';
import { auditWeeklyPortfolio } from './research/weekly-portfolio-risk.js';
import { buyAndHoldLqdt } from './research/weekly-lqdt-carry.js';
import { alignWeekdayBars } from './research/sbgb-sbmm-relative-lag.js';
import type { DailyBar } from './research/weekly-trend.js';

const protocolSha256 = digest(readFileSync('docs/SBMX_CONTINUOUS_HOLD_V1.md'));
if (protocolSha256 !== 'd35a3ed5b870bd99f220f710dac3811f8d08acec0999fc0ba6ed7e0029f17786') {
  throw new Error('Frozen SBMX continuous-hold protocol changed');
}
const sbmxSource = JSON.parse(readFileSync('.trading/sbmx-daily-2021-2025.json', 'utf8')) as {
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
  return {
    from,
    thru,
    entryDay: hold.entryDay,
    finalDay: hold.finalDay,
    ending: hold.endingLiquidationValue,
    maxDrawdownPct: portfolio.maxDrawdownPct,
    activeWeekWinRate: portfolio.activeWeekWinRate,
  };
}

const aligned = alignWeekdayBars(sbmxSource.rows, sbmmSource.rows);
const windows = [
  ['2022-01-01', '2022-12-31'],
  ['2023-01-01', '2023-12-31'],
  ['2024-01-01', '2024-12-31'],
  ['2025-01-01', '2025-12-31'],
  ['2022-01-01', '2025-12-31'],
] as const;
const years = windows.map(([from, thru]) => ({
  from,
  thru,
  sbmx: book(aligned.left, from, thru),
  sbmm: book(aligned.right, from, thru),
}));
const combined = years.at(-1)!;
const reasons: string[] = [];
if (combined.sbmx.ending <= combined.sbmm.ending) reasons.push('inferior-to-sbmm-cash-sleeve');
if (combined.sbmx.maxDrawdownPct <= -25) reasons.push('drawdown-at-least-25pct');
for (const year of years.slice(0, 4)) {
  if (year.sbmx.ending <= 1_000_000) reasons.push(`negative-year-${year.from.slice(0, 4)}`);
}
const report = {
  experiment: 'sbmx-continuous-hold-v1',
  protocolSha256,
  sbmxSourceSha256: sbmxSource.rowsSha256,
  sbmmSourceSha256: sbmmSource.rowsSha256,
  alignedDays: aligned.left.length,
  years,
  status: reasons.length ? 'not-admitted' : 'optional-equity-sleeve-requires-execution-audit',
  reasons,
};
writeFileSync('.trading/sbmx-continuous-hold-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({
  experiment: report.experiment,
  protocolSha256,
  alignedDays: aligned.left.length,
  years: years.map((year) => ({
    from: year.from,
    sbmxEnding: year.sbmx.ending,
    sbmmEnding: year.sbmm.ending,
    sbmxDrawdownPct: year.sbmx.maxDrawdownPct,
  })),
  status: report.status,
  reasons,
}, null, 2));
