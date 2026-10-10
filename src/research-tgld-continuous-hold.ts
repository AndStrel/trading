import { readFileSync, writeFileSync } from 'node:fs';
import { digest } from './research/verified-candles.js';
import { auditWeeklyPortfolio } from './research/weekly-portfolio-risk.js';
import { buyAndHoldLqdt } from './research/weekly-lqdt-carry.js';
import { alignWeekdayBars } from './research/sbgb-sbmm-relative-lag.js';
import type { DailyBar } from './research/weekly-trend.js';

const protocolSha256 = digest(readFileSync('docs/TGLD_CONTINUOUS_HOLD_V1.md'));
if (protocolSha256 !== '09f07cb196f3dbb450a33c8c472a09b9cbd62345eab09c4e183e42b19ec43e62') {
  throw new Error('Frozen TGLD continuous-hold protocol changed');
}
const tgldSource = JSON.parse(readFileSync('.trading/tgld-daily-2022-2025.json', 'utf8')) as {
  rowsSha256: string;
  rows: DailyBar[];
};
const sbmmSource = JSON.parse(readFileSync('.trading/sbmm-daily-2021-2025.json', 'utf8')) as {
  rowsSha256: string;
  rows: DailyBar[];
};
if (tgldSource.rowsSha256 !== '347575ab305338bcc9408be815366a5c12f37b164c10a5e08bf024a5e653ca2f') {
  throw new Error('Frozen TGLD daily source changed');
}
if (sbmmSource.rowsSha256 !== '6a70207aa52c48b620597cacadaab117de9d858711a1fae5047f2f075b88eca3') {
  throw new Error('Frozen SBMM source changed');
}

function book(rows: DailyBar[], from: string, thru: string) {
  const hold = buyAndHoldLqdt(rows, from, thru);
  const bars = rows.filter((bar) => bar.day <= thru);
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

const aligned = alignWeekdayBars(tgldSource.rows, sbmmSource.rows);
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
  tgld: book(aligned.left, from, thru),
  sbmm: book(aligned.right, from, thru),
}));
const combined = years.at(-1)!;
const reasons: string[] = [];
if (combined.tgld.ending <= combined.sbmm.ending) reasons.push('inferior-to-sbmm-cash-sleeve');
if (combined.tgld.maxDrawdownPct <= -25) reasons.push('drawdown-at-least-25pct');
for (const year of years.slice(0, 4)) {
  if (year.tgld.ending <= 1_000_000) reasons.push(`negative-year-${year.from.slice(0, 4)}`);
}
const report = {
  experiment: 'tgld-continuous-hold-v1',
  protocolSha256,
  tgldSourceSha256: tgldSource.rowsSha256,
  sbmmSourceSha256: sbmmSource.rowsSha256,
  alignedDays: aligned.left.length,
  years,
  status: reasons.length ? 'not-admitted' : 'optional-gold-sleeve-requires-execution-audit',
  reasons,
};
writeFileSync('.trading/tgld-continuous-hold-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({
  experiment: report.experiment,
  protocolSha256,
  alignedDays: aligned.left.length,
  years: years.map((year) => ({
    from: year.from,
    tgldEnding: year.tgld.ending,
    sbmmEnding: year.sbmm.ending,
    tgldDrawdownPct: year.tgld.maxDrawdownPct,
  })),
  status: report.status,
  reasons,
}, null, 2));
