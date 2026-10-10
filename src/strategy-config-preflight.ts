import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig, type ExecutionMode } from './config.js';
import type { TradingStrategyId } from './strategies/catalog.js';

export type StrategyConfigPreflightReport = {
  configReady: boolean;
  executionMode: ExecutionMode | null;
  selectedStrategyId: TradingStrategyId | null;
  liveSubmissionAllowed: false;
};

/** Pure deployment validation: no service startup, journal or broker calls. */
export function strategyConfigPreflight(env: NodeJS.ProcessEnv): StrategyConfigPreflightReport {
  try {
    const config = loadConfig(env);
    if (config.scanner.universeMode === 'watchlist' && !config.scanner.intradayWatchlist.length) {
      throw new Error('Scanner watchlist must contain at least one exchange-labeled instrument');
    }
    return {
      configReady: true,
      executionMode: config.execution.mode,
      selectedStrategyId: config.scanner.tradingStrategyId,
      liveSubmissionAllowed: false,
    };
  } catch {
    // Validation errors may embed raw environment strings. Failure is a fixed,
    // value-free report; never serialize exceptions, tokens, IDs or watchlists.
    return { configReady: false, executionMode: null, selectedStrategyId: null, liveSubmissionAllowed: false };
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const report = strategyConfigPreflight(process.env);
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.exitCode = report.configReady ? 0 : 1;
}
