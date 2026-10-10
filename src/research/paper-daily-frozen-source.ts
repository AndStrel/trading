import { readFileSync } from 'node:fs';

import { paperDualMomentumSnapshotFiles } from './paper-daily-snapshot.js';
import type { DailyBar } from './weekly-trend.js';

/**
 * Pinned row SHA-256 for admitted paper dual-momentum reproduction.
 * After `research:refresh-paper-daily`, if MOEX rows change, update these constants
 * only after re-running admission gates on the frozen 2022–2025 window.
 */
export const FROZEN_PAPER_ETF_ROWS_SHA256 = {
  sbmx: '31e0501946b7e733d35f4138d196d3e191e1513e9ebfa385bce68a87f901f6ed',
  sbgb: '0fbfae6a340f6c58e4f9b3132d005fe99d3f63969909d5a1eed5de1cc2ca56f4',
  sbmm: '79be545eefeb2305911e631e15cadcb93a3bde2f514023a5bcd4284945dda016',
} as const;

type Snapshot = { rowsSha256: string; rows: DailyBar[] };

export function readPaperEtfDailySnapshot(which: keyof typeof FROZEN_PAPER_ETF_ROWS_SHA256): Snapshot {
  const files = paperDualMomentumSnapshotFiles();
  const path = files[which];
  const snapshot = JSON.parse(readFileSync(path, 'utf8')) as Snapshot;
  if (!snapshot.rowsSha256 || !Array.isArray(snapshot.rows)) {
    throw new Error(`Invalid paper ETF snapshot ${path}`);
  }
  return snapshot;
}

export function assertFrozenPaperEtfSnapshots(): {
  sbmx: Snapshot;
  sbgb: Snapshot;
  sbmm: Snapshot;
} {
  const sbmx = readPaperEtfDailySnapshot('sbmx');
  const sbgb = readPaperEtfDailySnapshot('sbgb');
  const sbmm = readPaperEtfDailySnapshot('sbmm');
  if (sbmx.rowsSha256 !== FROZEN_PAPER_ETF_ROWS_SHA256.sbmx) {
    throw new Error('Frozen SBMX paper source changed; update FROZEN_PAPER_ETF_ROWS_SHA256 after gate check');
  }
  if (sbgb.rowsSha256 !== FROZEN_PAPER_ETF_ROWS_SHA256.sbgb) {
    throw new Error('Frozen SBGB paper source changed; update FROZEN_PAPER_ETF_ROWS_SHA256 after gate check');
  }
  if (sbmm.rowsSha256 !== FROZEN_PAPER_ETF_ROWS_SHA256.sbmm) {
    throw new Error('Frozen SBMM paper source changed; update FROZEN_PAPER_ETF_ROWS_SHA256 after gate check');
  }
  return { sbmx, sbgb, sbmm };
}
