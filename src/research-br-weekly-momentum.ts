import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { br2024DaySpecs, readCachedBr2024Day } from './research-br-2024-source.js';
import { br2025DaySpecs, readCachedBr2025Day } from './research-br-2025-source.js';
import {
  brWeeklyBreakEvenMove,
  buildBrWeekAnchors,
  evaluateBrWeeklyMomentum,
  summarizeBrWeeklyMomentum,
  type BrDaySnapshot,
} from './research/br-weekly-momentum.js';

const protocolPath = join(process.cwd(), 'docs', 'BR_WEEKLY_MOMENTUM_V1.md');
const reportPath = join(process.cwd(), '.trading', 'br-weekly-momentum-v1.json');
const locked2024 = '49fe00ecb754dbb7af599a1765cbc7b762b2a4189da68a4b70124f9304fd7494';
const locked2025 = '0accb82bf1f5ac7808df713620cab57a4217e440d9a369f4817c863476f95969';
const noSession2024 = new Set(['2024-02-23', '2024-03-08', '2024-05-01', '2024-05-09', '2024-06-12']);
const noSession2025 = new Set(['2025-05-01', '2025-05-09', '2025-06-12']);

function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function load2024(): { sourceSha256: string; days: BrDaySnapshot[] } {
  const reportFile = join(process.cwd(), '.trading', 'br-2024-continuous-source.json');
  if (!existsSync(reportFile) || sha256(readFileSync(reportFile)) !== locked2024) {
    throw new Error('Locked BR 2024 source report missing or changed');
  }
  const days: BrDaySnapshot[] = [];
  for (const spec of br2024DaySpecs()) {
    if (noSession2024.has(spec.date)) {
      days.push({ date: spec.date, contract: spec.contract, candles: [] });
      continue;
    }
    const { candles } = readCachedBr2024Day(spec);
    days.push({ date: spec.date, contract: spec.contract, candles });
  }
  return { sourceSha256: locked2024, days };
}

function load2025(): { sourceSha256: string; days: BrDaySnapshot[] } {
  const reportFile = join(process.cwd(), '.trading', 'br-2025-continuous-source.json');
  if (!existsSync(reportFile) || sha256(readFileSync(reportFile)) !== locked2025) {
    throw new Error('Locked BR 2025 source report missing or changed');
  }
  const days: BrDaySnapshot[] = [];
  for (const spec of br2025DaySpecs()) {
    if (noSession2025.has(spec.date)) {
      days.push({ date: spec.date, contract: spec.contract, candles: [] });
      continue;
    }
    const { candles } = readCachedBr2025Day(spec);
    days.push({ date: spec.date, contract: spec.contract, candles });
  }
  return { sourceSha256: locked2025, days };
}

function gate(summary: ReturnType<typeof summarizeBrWeeklyMomentum>, label: string, reasons: string[]) {
  if (summary.unresolvedExit > 0) reasons.push(`${label}:unresolved-exit`);
  if (summary.trades < 50) reasons.push(`${label}:insufficient-trades`);
  if (summary.winRate === null || summary.winRate < 0.51) reasons.push(`${label}:win-rate`);
  if (summary.meanBaseNet === null || summary.meanBaseNet <= 0) reasons.push(`${label}:mean-base`);
  if (summary.meanStressNet === null || summary.meanStressNet <= 0) reasons.push(`${label}:mean-stress`);
  if (summary.profitFactor !== null && summary.profitFactor <= 1) reasons.push(`${label}:profit-factor`);
  if (summary.profitFactor === null && !(summary.trades > 0 && summary.winners === summary.trades)) {
    reasons.push(`${label}:profit-factor-null`);
  }
  if (summary.withoutBestWeekSum === null || summary.withoutBestWeekSum <= 0) {
    reasons.push(`${label}:without-best`);
  }
}

function main(): void {
  if (process.argv.length !== 2) throw new Error('Offline discovery takes no flags');
  if (!existsSync(protocolPath)) throw new Error(`Missing protocol ${protocolPath}`);
  const protocolSha256 = sha256(readFileSync(protocolPath));
  const y2024 = load2024();
  const y2025 = load2025();

  const anchors2024 = buildBrWeekAnchors(y2024.days);
  const anchors2025 = buildBrWeekAnchors(y2025.days);
  const decisions2024 = evaluateBrWeeklyMomentum(anchors2024);
  const decisions2025 = evaluateBrWeeklyMomentum(anchors2025);
  const combinedDecisions = [...decisions2024, ...decisions2025];

  const combined = summarizeBrWeeklyMomentum(combinedDecisions);
  const block2024 = summarizeBrWeeklyMomentum(decisions2024);
  const block2025 = summarizeBrWeeklyMomentum(decisions2025);

  const reasons: string[] = [];
  gate(combined, 'combined', reasons);
  if (block2024.meanBaseNet === null || block2024.meanBaseNet <= 0) reasons.push('2024:mean-base');
  if (block2025.meanBaseNet === null || block2025.meanBaseNet <= 0) reasons.push('2025:mean-base');
  if (combined.trades < 50) reasons.push('combined:trade-weeks');

  const status = reasons.length === 0 ? 'requires-2026-holdout' : 'rejected-at-development-gate';
  const report = {
    experiment: 'br-weekly-momentum-v1',
    protocolSha256,
    breakEvenMove: brWeeklyBreakEvenMove(),
    sources: { y2024: y2024.sourceSha256, y2025: y2025.sourceSha256 },
    anchors: { y2024: anchors2024.length, y2025: anchors2025.length },
    combined,
    block2024,
    block2025,
    status,
    reasons,
    decisions: combinedDecisions,
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({
    experiment: report.experiment,
    protocolSha256,
    breakEvenMove: report.breakEvenMove,
    sources: report.sources,
    anchors: report.anchors,
    combined,
    block2024,
    block2025,
    status,
    reasons,
    reportPath,
  }, null, 2));
}

main();
