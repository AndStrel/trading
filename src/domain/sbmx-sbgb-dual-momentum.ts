import { existsSync, readFileSync } from 'node:fs';
import { simulateDualMomentumThree, type DualSleeve } from '../research/dual-momentum-three.js';
import { paperDualMomentumSnapshotFiles } from '../research/paper-daily-snapshot.js';
import type { DailyBar } from '../research/weekly-trend.js';

export const PAPER_DUAL_MOMENTUM_TICKERS = ['SBMX', 'SBGB', 'SBMM'] as const;
export type PaperDualMomentumTicker = (typeof PAPER_DUAL_MOMENTUM_TICKERS)[number];

const SLEEVE_TICKER: Record<Exclude<DualSleeve, 'tgld'> | 'tgld', PaperDualMomentumTicker> = {
  sbmx: 'SBMX',
  tgld: 'SBGB',
  sbmm: 'SBMM',
};

export function paperDualMomentumAsOf(
  sbmx: readonly DailyBar[],
  sbgb: readonly DailyBar[],
  sbmm: readonly DailyBar[],
  asOf: string,
): {
  asOf: string;
  firstSignalDay: string | null;
  sleeve: PaperDualMomentumTicker | null;
  live: false;
} {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error('asOf must be YYYY-MM-DD');
  const overlay = simulateDualMomentumThree({ sbmx, tgld: sbgb, sbmm, from: '2021-01-01', thru: asOf });
  const live = overlay.marks.filter((mark) => mark.day <= asOf && mark.sleeve !== null).at(-1);
  return {
    asOf,
    firstSignalDay: overlay.firstSignalDay,
    sleeve: live?.sleeve ? SLEEVE_TICKER[live.sleeve] : null,
    live: false,
  };
}

type Snapshot = { rowsSha256: string; rows: DailyBar[] };

function lastAlignedDay(rows: readonly DailyBar[]): string {
  const day = rows.at(-1)?.day;
  if (!day) throw new Error('Daily snapshot is empty');
  return day;
}

export function readPaperDualMomentumSignal(asOf: string, files = paperDualMomentumSnapshotFiles()):
  | { available: false; reason: string; live: false }
  | {
      available: true;
      live: false;
      asOf: string;
      requestedAsOf?: string;
      dataThrough: string;
      stale: boolean;
      firstSignalDay: string | null;
      sleeve: PaperDualMomentumTicker | null;
    } {
  if ([files.sbmx, files.sbgb, files.sbmm].some((path) => !existsSync(path))) {
    return { available: false, reason: 'local-daily-snapshots-missing', live: false };
  }
  const sbmx = JSON.parse(readFileSync(files.sbmx, 'utf8')) as Snapshot;
  const sbgb = JSON.parse(readFileSync(files.sbgb, 'utf8')) as Snapshot;
  const sbmm = JSON.parse(readFileSync(files.sbmm, 'utf8')) as Snapshot;
  const dataThrough = [lastAlignedDay(sbmx.rows), lastAlignedDay(sbgb.rows), lastAlignedDay(sbmm.rows)].reduce(
    (left, right) => (left < right ? left : right),
  );
  const effectiveAsOf = asOf > dataThrough ? dataThrough : asOf;
  const stale = asOf > dataThrough;
  return {
    available: true,
    stale,
    dataThrough,
    ...(stale ? { requestedAsOf: asOf } : {}),
    ...paperDualMomentumAsOf(sbmx.rows, sbgb.rows, sbmm.rows, effectiveAsOf),
  };
}
