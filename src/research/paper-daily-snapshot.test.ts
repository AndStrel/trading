import { describe, expect, it } from 'vitest';

import {
  assertDailyYearCoverage,
  paperDualMomentumSnapshotFiles,
  paperSnapshotDir,
} from './paper-daily-snapshot.js';

describe('paper daily snapshots', () => {
  it('resolves snapshot paths under the configured directory', () => {
    const previous = process.env.T_INVEST_PAPER_SNAPSHOT_DIR;
    process.env.T_INVEST_PAPER_SNAPSHOT_DIR = '/data/paper';
    try {
      expect(paperSnapshotDir()).toBe('/data/paper');
      expect(paperDualMomentumSnapshotFiles()).toEqual({
        sbmx: '/data/paper/sbmx-daily-2021-2025.json',
        sbgb: '/data/paper/sbgb-daily-2021-2025.json',
        sbmm: '/data/paper/sbmm-daily-2021-2025.json',
      });
    } finally {
      if (previous === undefined) delete process.env.T_INVEST_PAPER_SNAPSHOT_DIR;
      else process.env.T_INVEST_PAPER_SNAPSHOT_DIR = previous;
    }
  });

  it('allows partial 2026 coverage', () => {
    expect(() => assertDailyYearCoverage(2026, 120)).not.toThrow();
    expect(() => assertDailyYearCoverage(2026, 0)).toThrow(/Unexpected partial-year/);
  });
});
