import { pathToFileURL } from 'node:url';

import {
  parseReplayArgs,
  runReplay,
  type ReplayCliOptions,
  type ReplayRunResult,
} from './backtest-replay.js';

const DEFAULT_TARGET_RISK_MULTIPLES = [0.75, 1, 1.25, 1.5, 2, 2.5] as const;
const MAX_TARGET_RISK_MULTIPLES = 10;

export type ReplaySweepOptions = {
  replay: ReplayCliOptions;
  targetRiskMultiples: number[];
};

const usage = `Usage:
  npm run backtest:replay:sweep -- --year 2025
  npm run backtest:replay:sweep -- --year 2025 --target-risk-multiple 0.75,1,1.25,1.5,2,2.5

Runs the same registered replay against several target multiples. It is a research report only:
the out-of-sample phase is reported but never used to choose a winner, and no broker order is sent.`;

function parseTargetRiskMultiples(value: string): number[] {
  const parts = value.split(',').map((part) => part.trim());
  const parsed = parts.map((part) => Number(part));
  if (
    parsed.length === 0 ||
    parsed.length > MAX_TARGET_RISK_MULTIPLES ||
    parts.some((part) => part.length === 0) ||
    parsed.some((part) => !Number.isFinite(part) || part <= 0)
  ) {
    throw new Error(
      `--target-risk-multiple must contain 1-${MAX_TARGET_RISK_MULTIPLES} positive comma-separated numbers`,
    );
  }
  const unique = [...new Set(parsed)];
  if (unique.length !== parsed.length) throw new Error('--target-risk-multiple values must be unique');
  return unique;
}

export function parseReplaySweepArgs(args: string[]): ReplaySweepOptions {
  const replayArgs: string[] = [];
  let targetRiskMultiples: number[] = [...DEFAULT_TARGET_RISK_MULTIPLES];
  let targetRiskMultipleFlagSeen = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    const [flag, inlineValue] = argument.split('=', 2);
    if (flag !== '--target-risk-multiple') {
      replayArgs.push(argument);
      continue;
    }
    if (targetRiskMultipleFlagSeen) throw new Error('--target-risk-multiple may be provided only once');
    targetRiskMultipleFlagSeen = true;
    const value = inlineValue ?? args[index + 1];
    if (!value || value.startsWith('--')) throw new Error('--target-risk-multiple requires a value');
    if (inlineValue === undefined) index += 1;
    targetRiskMultiples = parseTargetRiskMultiples(value);
  }

  return {
    replay: parseReplayArgs(replayArgs),
    targetRiskMultiples,
  };
}

type SweepRun = Pick<ReplayRunResult, 'report'> & { targetRiskMultiple: number };

async function main(): Promise<void> {
  const options = parseReplaySweepArgs(process.argv.slice(2));
  if (options.replay.help) {
    console.log(usage);
    return;
  }
  if (options.replay.year === null) throw new Error(`An explicit --year is required.\n\n${usage}`);

  const results: SweepRun[] = [];
  let metadata: ReplayRunResult | null = null;
  for (const targetRiskMultiple of options.targetRiskMultiples) {
    const result = await runReplay(options.replay, {
      targetRiskMultiple,
      // The sweep deliberately measures lower targets; the production trade-plan default
      // remains 2.0 when no explicit override is supplied by a live caller.
      minimumRewardToRisk: 0,
    });
    metadata ??= result;
    results.push({ targetRiskMultiple, report: result.report });
  }

  if (metadata === null) throw new Error('Target sweep produced no runs');
  console.log(
    JSON.stringify({
      status: 'ok',
      mode: 'target-risk-sweep',
      year: metadata.year,
      requestedTickers: metadata.requestedTickers,
      sourceCommit: metadata.sourceCommit,
      archives: metadata.archives,
      targetRiskMultiples: options.targetRiskMultiples,
      runs: results,
    }),
  );
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  main().catch((error: unknown) => {
    const detail = error instanceof Error ? error.message : 'unknown replay sweep error';
    console.error(`Historical replay sweep failed: ${detail}`);
    process.exitCode = 1;
  });
}
