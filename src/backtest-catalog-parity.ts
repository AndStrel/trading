import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { catalogAccountTotals } from './backtest/catalog-account-totals.js';
import { validateCatalogCohortViability } from './backtest/catalog-cohort-viability.js';
import {
  DEFAULT_CATALOG_REPLAY_POLICY, replayCatalogStrategy, repriceCatalogTrades,
  type CatalogParityReplayResult,
} from './backtest/catalog-parity-replay.js';
import { priceToNano } from './domain/price-tick.js';
import { loadReadOnlyReplaySource } from './history/read-only-replay-source.js';

export type CatalogReplayCostScenario = 'investor' | 'public-trader' | 'conditional-003';
export type CatalogReplayCliOptions = {
  databasePath: string | null;
  capitals: Array<500 | 1000>;
  costs: CatalogReplayCostScenario[];
  help: boolean;
};

const costScenarios = {
  investor: { commissionRate: 0.003, monthlyFeeRub: 0, confirmedForProductionFloor: true },
  'public-trader': { commissionRate: 0.0005, monthlyFeeRub: 390, confirmedForProductionFloor: false },
  'conditional-003': { commissionRate: 0.0003, monthlyFeeRub: 390, confirmedForProductionFloor: false },
} as const;

export const CATALOG_PARITY_CLI_USAGE = `Usage:
  npm run backtest:catalog -- --database /absolute/path/finalized-history.sqlite
  npm run backtest:catalog -- --database /absolute/path/finalized-history.sqlite --capital 500 --cost all

Frozen hypothesis: SBER / trend-momentum-v1, 2025-08-01 through 2026-09-26.
Defaults: both 500 and 1000 RUB, Investor commission 0.003 per side.
--capital: 500 | 1000 | both; --cost: investor | public-trader | conditional-003 | all.
Reads finalized archive-linked SQLite without migration, copying or sidecar writes.
Prints development-only JSON; no .env, network, broker clients or orders.
Nonempty WAL/SHM/journal is an error. A passing candle model NEVER admits trading.`;

export function parseCatalogReplayArgs(args: readonly string[]): CatalogReplayCliOptions {
  const options: CatalogReplayCliOptions = { databasePath: null, capitals: [500, 1000], costs: ['investor'], help: false };
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === '--help' || argument === '-h') { options.help = true; continue; }
    const separator = argument.indexOf('=');
    const flag = separator < 0 ? argument : argument.slice(0, separator);
    if (!['--database', '--capital', '--cost'].includes(flag) || seen.has(flag)) {
      throw new Error('Unknown or repeated catalog replay option');
    }
    seen.add(flag);
    const value = separator < 0 ? args[++index] : argument.slice(separator + 1);
    if (!value || value.startsWith('-')) throw new Error('Catalog replay option requires a value');
    if (flag === '--database') {
      if (!isAbsolute(value) || value.includes('\0') || value.length > 4096) throw new Error('An absolute database path is required');
      options.databasePath = value;
    } else if (flag === '--capital') {
      if (!['500', '1000', 'both'].includes(value)) throw new Error('Capital must be 500, 1000 or both');
      options.capitals = value === 'both' ? [500, 1000] : [Number(value) as 500 | 1000];
    } else {
      if (value === 'all') options.costs = ['investor', 'public-trader', 'conditional-003'];
      else if (Object.hasOwn(costScenarios, value)) options.costs = [value as CatalogReplayCostScenario];
      else throw new Error('Unsupported predeclared cost scenario');
    }
  }
  return options;
}

function decisionSummary(result: CatalogParityReplayResult) {
  const statuses: Record<string, number> = {};
  const reasons = new Map<string, number>();
  for (const decision of result.decisions) {
    statuses[decision.status] = (statuses[decision.status] ?? 0) + 1;
    for (const reason of new Set(decision.reasons)) reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  return { statuses, reasons: [...reasons].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([reason, count]) => ({ reason, count })) };
}

export function runCatalogReplayCli(options: CatalogReplayCliOptions) {
  if (!options.databasePath) throw new Error('An explicit --database is required');
  if (!isAbsolute(options.databasePath) || options.capitals.length === 0 || options.costs.length === 0
    || new Set(options.capitals).size !== options.capitals.length || new Set(options.costs).size !== options.costs.length
    || options.capitals.some(capital => capital !== 500 && capital !== 1000)
    || options.costs.some(cost => !Object.hasOwn(costScenarios, cost))) throw new Error('Invalid frozen replay options');
  const source = loadReadOnlyReplaySource({ databasePath: options.databasePath, ticker: 'SBER',
    from: '2025-08-01T00:00:00.000Z', to: '2026-09-27T00:00:00.000Z' });
  if (source.archives.some(archive => archive.lotSize !== 1 || archive.priceStep !== 0.01)) {
    throw new Error('Archive metadata differs from the frozen post-August SBER model');
  }
  const step = priceToNano(0.01);
  if (source.candles.some(candle => [candle.open, candle.high, candle.low, candle.close]
    .some(price => priceToNano(price) % step !== 0n))) throw new Error('Candle price differs from the frozen SBER tick');

  const scenarios = options.capitals.flatMap(capitalRub => options.costs.map(costScenario => {
    const costs = costScenarios[costScenario];
    const result = replayCatalogStrategy({ strategyId: 'trend-momentum-v1',
      instrument: { instrumentId: source.archives[0]!.instrumentId, ticker: 'SBER', lotSize: 1, priceStep: 0.01 },
      minuteCandles: source.candles,
      policy: { ...DEFAULT_CATALOG_REPLAY_POLICY, capitalRub, commissionRate: costs.commissionRate, slippageRate: 0.0005 },
    });
    const account = catalogAccountTotals(result.modeledTrades, costs.monthlyFeeRub);
    const cashAndRiskPath = validateCatalogCohortViability({ originalTrades: result.modeledTrades,
      repricedTrades: result.modeledTrades, policy: { ...result.policy, monthlyFeeRub: costs.monthlyFeeRub } });
    const stress = repriceCatalogTrades(result.modeledTrades, { commissionRate: costs.commissionRate, slippageRate: 0.001 });
    const stressAccount = catalogAccountTotals(stress.modeledTrades, costs.monthlyFeeRub);
    const stressCashAndRiskPath = validateCatalogCohortViability({ originalTrades: result.modeledTrades,
      repricedTrades: stress.modeledTrades,
      policy: { ...result.policy, slippageRate: 0.001, monthlyFeeRub: costs.monthlyFeeRub } });
    const frozenInvestorCostSensitivities = costScenario === 'investor'
      ? (['public-trader', 'conditional-003'] as const).map(name => {
        const sensitivity = repriceCatalogTrades(result.modeledTrades,
          { commissionRate: costScenarios[name].commissionRate, slippageRate: 0.0005 });
        const sensitivityPath = validateCatalogCohortViability({ originalTrades: result.modeledTrades,
          repricedTrades: sensitivity.modeledTrades, policy: { ...result.policy,
            commissionRate: costScenarios[name].commissionRate, monthlyFeeRub: costScenarios[name].monthlyFeeRub } });
        return { costScenario: name, cohort: sensitivity.cohort, productionCompatible: false,
          cashFeasibilityProven: sensitivityPath.cashFeasibilityProven, riskLimitsProven: sensitivityPath.riskLimitsProven,
          cashAndRiskPath: sensitivityPath,
          account: catalogAccountTotals(sensitivity.modeledTrades, costScenarios[name].monthlyFeeRub),
          admission: sensitivity.admission };
      }) : [];
    const checks = {
      minimum100ClosedTrades: account.closedTrades >= 100,
      minimum50EntryDates: account.entryDates >= 50,
      minimum51PercentNetWins: account.closedTrades > 0 && 100 * account.winningTrades >= 51 * account.closedTrades,
      positiveMeanAndAccountNet: BigInt(account.tradeNetNano) > 0n && BigInt(account.accountNetNano) > 0n,
      eachPredeclaredPeriodPositive: account.periods.every(period => BigInt(period.accountNetNano) > 0n),
      sameCohortStressPositive: BigInt(stressAccount.accountNetNano) > 0n,
      baseCashAndRiskPathProven: cashAndRiskPath.pathProven,
      stressCashAndRiskPathProven: stressCashAndRiskPath.pathProven,
      positiveAfterRemovingFiveBest: BigInt(account.withoutFiveBestAccountNetNano) > 0n,
      zeroUnresolved: account.unresolvedTrades === 0,
      accountCashPathIncludesServiceFees: cashAndRiskPath.pathProven,
    };
    return { costScenario, capitalRub, policy: result.policy, productionCompatible: result.productionCompatible,
      coverage: result.coverage, decisions: decisionSummary(result), modeledTrades: result.modeledTrades,
      metrics: result.metrics, account, cashAndRiskPath,
      knownUnresolvedEntryCostsNano: result.modeledTrades.filter(trade => trade.status === 'unresolved')
        .reduce((sum, trade) => sum + BigInt(trade.entryCommissionNano) + BigInt(trade.entrySlippageNano), 0n).toString(),
      stress: { cohort: stress.cohort, account: stressAccount, metrics: stress.metrics,
        cashAndRiskPathProven: stressCashAndRiskPath.pathProven, cashAndRiskPath: stressCashAndRiskPath,
        interpretation: 'same-cohort modeled cash/risk path; never executable market evidence' },
      frozenInvestorCostSensitivities,
      modelScreen: { checks, passes: Object.values(checks).every(Boolean),
        warning: 'Candle model only. Failed cash/risk paths invalidate modeled feasibility; actual billing and executable market evidence remain unproven.' },
      admission: { allowed: false as const, executableEvidence: false as const } };
  }));
  return { protocol: 'catalog-parity-replay-v1', hypothesis: 'SBER/trend-momentum-v1', researchStatus: 'development-only',
    historicalTickAssumption: '0.01 RUB; import metadata is not historical as-of proof',
    source: { readOnly: source.readOnly, provenanceEvidence: source.provenanceEvidence, contentSha256: source.contentSha256,
      archives: source.archives, coverage: source.coverage, warnings: source.warnings },
    scenarios, admission: { allowed: false as const, executableEvidence: false as const }, ordersSubmitted: false };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const options = parseCatalogReplayArgs(process.argv.slice(2));
    if (options.help) process.stdout.write(`${CATALOG_PARITY_CLI_USAGE}\n`);
    else process.stdout.write(`${JSON.stringify(runCatalogReplayCli(options), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Catalog replay failed'}\n`);
    process.exitCode = 1;
  }
}
