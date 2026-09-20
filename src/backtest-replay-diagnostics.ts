import { pathToFileURL } from 'node:url';

import {
  parseReplayArgs,
  runReplay,
  type ReplayCliOptions,
  type ReplayRunResult,
} from './backtest-replay.js';

const DIAGNOSTIC_TARGET_RISK_MULTIPLE = 1;

type DiagnosticCase = {
  id: string;
  description: string;
  overrides: Parameters<typeof runReplay>[1];
};

export const REPLAY_DIAGNOSTIC_CASES: readonly DiagnosticCase[] = [
  {
    id: 'baseline',
    description: 'Production costs and portfolio limits',
    overrides: { targetRiskMultiple: DIAGNOSTIC_TARGET_RISK_MULTIPLE, minimumRewardToRisk: 0 },
  },
  {
    id: 'zero-cost',
    description: 'Zero commission and slippage; production portfolio limits',
    overrides: {
      targetRiskMultiple: DIAGNOSTIC_TARGET_RISK_MULTIPLE,
      minimumRewardToRisk: 0,
      commissionRate: 0,
      slippageRate: 0,
    },
  },
  {
    id: 'relaxed-portfolio',
    description: 'Production costs; enough capital and concurrency to avoid capacity effects',
    overrides: {
      targetRiskMultiple: DIAGNOSTIC_TARGET_RISK_MULTIPLE,
      minimumRewardToRisk: 0,
      startingCapitalRub: 1_000_000,
      maxPositionRub: 500_000,
      maxConcurrentPositions: 20,
    },
  },
  {
    id: 'zero-cost-relaxed-portfolio',
    description: 'Zero costs and relaxed portfolio limits',
    overrides: {
      targetRiskMultiple: DIAGNOSTIC_TARGET_RISK_MULTIPLE,
      minimumRewardToRisk: 0,
      commissionRate: 0,
      slippageRate: 0,
      startingCapitalRub: 1_000_000,
      maxPositionRub: 500_000,
      maxConcurrentPositions: 20,
    },
  },
] as const;

const usage = `Usage:
  npm run backtest:replay:diagnostics -- --year 2025
  npm run backtest:replay:diagnostics -- --year 2025 --ticker SBER,GAZP

Runs fixed-target research diagnostics. It does not select a production parameter,
change live configuration, or send broker orders.`;

type DiagnosticRun = {
  id: string;
  description: string;
  report: ReplayRunResult['report'];
};

export async function runReplayDiagnostics(options: ReplayCliOptions): Promise<{
  status: 'ok';
  mode: 'replay-diagnostics';
  year: number;
  requestedTickers: string[];
  sourceCommit: string | null;
  archives: ReplayRunResult['archives'];
  targetRiskMultiple: number;
  cases: DiagnosticRun[];
}> {
  const cases: DiagnosticRun[] = [];
  let metadata: ReplayRunResult | null = null;

  for (const [index, diagnosticCase] of REPLAY_DIAGNOSTIC_CASES.entries()) {
    console.error(
      `[replay-diagnostics] ${index + 1}/${REPLAY_DIAGNOSTIC_CASES.length} ${diagnosticCase.id} started`,
    );
    const result = await runReplay(options, diagnosticCase.overrides);
    metadata ??= result;
    cases.push({ id: diagnosticCase.id, description: diagnosticCase.description, report: result.report });
    console.error(`[replay-diagnostics] ${index + 1}/${REPLAY_DIAGNOSTIC_CASES.length} ${diagnosticCase.id} completed`);
  }

  if (metadata === null) throw new Error('Replay diagnostics produced no runs');
  return {
    status: 'ok',
    mode: 'replay-diagnostics',
    year: metadata.year,
    requestedTickers: metadata.requestedTickers,
    sourceCommit: metadata.sourceCommit,
    archives: metadata.archives,
    targetRiskMultiple: DIAGNOSTIC_TARGET_RISK_MULTIPLE,
    cases,
  };
}

async function main(): Promise<void> {
  const options = parseReplayArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage);
    return;
  }
  if (options.year === null) throw new Error(`An explicit --year is required.\n\n${usage}`);
  console.log(JSON.stringify(await runReplayDiagnostics(options)));
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  main().catch((error: unknown) => {
    const detail = error instanceof Error ? error.message : 'unknown replay diagnostics error';
    console.error(`Historical replay diagnostics failed: ${detail}`);
    process.exitCode = 1;
  });
}
