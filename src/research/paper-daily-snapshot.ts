import { join } from 'node:path';

/** Years fetched for paper dual-momentum daily snapshots (prospective 2026 append; admission gates remain 2022–2025). */
export const PAPER_ETF_DAILY_YEARS = [2021, 2022, 2023, 2024, 2025, 2026] as const;

export const PAPER_ETF_DAILY_SCOPE =
  '2021-2026 operational append; frozen dual-momentum admission used 2022-05-04–2025 only';

export function paperSnapshotDir(): string {
  const raw = process.env.T_INVEST_PAPER_SNAPSHOT_DIR?.trim();
  return raw && raw.length > 0 ? raw : '.trading';
}

export function paperDualMomentumSnapshotFiles(dir = paperSnapshotDir()) {
  return {
    sbmx: join(dir, 'sbmx-daily-2021-2025.json'),
    sbgb: join(dir, 'sbgb-daily-2021-2025.json'),
    sbmm: join(dir, 'sbmm-daily-2021-2025.json'),
  };
}

export function assertDailyYearCoverage(year: number, count: number): void {
  if (year === 2026) {
    if (count < 1 || count > 400) {
      throw new Error(`Unexpected partial-year coverage for ${year}: ${count}`);
    }
    return;
  }
  if (year >= 2023 && (count < 150 || count > 400)) {
    throw new Error(`Unexpected coverage for ${year}: ${count}`);
  }
}
