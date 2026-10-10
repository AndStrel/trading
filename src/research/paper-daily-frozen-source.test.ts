import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { assertFrozenPaperEtfSnapshots, FROZEN_PAPER_ETF_ROWS_SHA256 } from './paper-daily-frozen-source.js';
import { paperDualMomentumSnapshotFiles } from './paper-daily-snapshot.js';

describe('paper ETF frozen snapshots', () => {
  it('matches pinned SHA-256 when local daily JSON is present', () => {
    const files = paperDualMomentumSnapshotFiles();
    if (![files.sbmx, files.sbgb, files.sbmm].every((path) => existsSync(path))) {
      return;
    }
    const loaded = assertFrozenPaperEtfSnapshots();
    expect(loaded.sbmx.rowsSha256).toBe(FROZEN_PAPER_ETF_ROWS_SHA256.sbmx);
    expect(loaded.sbgb.rowsSha256).toBe(FROZEN_PAPER_ETF_ROWS_SHA256.sbgb);
    expect(loaded.sbmm.rowsSha256).toBe(FROZEN_PAPER_ETF_ROWS_SHA256.sbmm);
  });
});
