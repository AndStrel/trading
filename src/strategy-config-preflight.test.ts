import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { strategyConfigPreflight } from './strategy-config-preflight.js';

const temporaryDirectories: string[] = [];
const root = resolve(import.meta.dirname, '..');

function runLocalDeploy(failingStage = '') {
  const directory = mkdtempSync(join(tmpdir(), 'trading-deploy-'));
  temporaryDirectories.push(directory);
  const bin = join(directory, 'bin');
  const log = join(directory, 'commands.jsonl');
  mkdirSync(bin);
  // Execute the actual npm script against a synthetic Docker executable. No
  // Docker daemon, network, service replacement or broker request is involved.
  writeFileSync(join(bin, 'docker'), `#!${process.execPath}\nconst { appendFileSync } = require('node:fs');\nconst args = process.argv.slice(2);\nappendFileSync(process.env.SYNTHETIC_DEPLOY_LOG, JSON.stringify(args) + '\\n');\nconst stage = args[1] === 'build' ? 'build' : args.includes('dist/strategy-config-preflight.js') ? 'preflight' : 'up';\nprocess.exit(stage === process.env.SYNTHETIC_DEPLOY_FAILURE ? 1 : 0);\n`, { mode: 0o700 });
  const script = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts.deploy as string;
  const result = spawnSync(script, { cwd: root, shell: true, encoding: 'utf8', env: {
    PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
    SYNTHETIC_DEPLOY_LOG: log, SYNTHETIC_DEPLOY_FAILURE: failingStage,
  } });
  const commands = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line) as string[]);
  return { result, commands };
}
afterEach(() => {
  vi.unstubAllGlobals();
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('strategy configuration deployment preflight', () => {
  it('validates actual strategy defaults without network or journal writes', () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error('Network is forbidden'));
    vi.stubGlobal('fetch', fetchSpy);
    const directory = mkdtempSync(join(tmpdir(), 'trading-preflight-'));
    temporaryDirectories.push(directory);
    const journal = join(directory, 'not-created', 'journal.sqlite');
    const marketData = join(directory, 'not-created', 'market-data.sqlite');
    expect(strategyConfigPreflight({ T_INVEST_JOURNAL_PATH: journal, T_INVEST_MARKET_DATA_PATH: marketData })).toEqual({
      configReady: true, executionMode: 'disabled', selectedStrategyId: 'trend-momentum-v1', liveSubmissionAllowed: false,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(existsSync(join(directory, 'not-created'))).toBe(false);
  });

  it('accepts a migrated watchlist with explicit exchange ticker labels', () => {
    expect(strategyConfigPreflight({ T_INVEST_INTRADAY_UNIVERSE: 'watchlist',
      T_INVEST_TRADING_STRATEGY_ID: 'vwap-reclaim-v1',
      T_INVEST_INTRADAY_WATCHLIST: JSON.stringify([{ instrumentId: 'synthetic-instrument-uid', label: 'VTBR', lotSize: 1, priceStep: 0.01 }]),
    })).toEqual({ configReady: true, executionMode: 'disabled', selectedStrategyId: 'vwap-reclaim-v1', liveSubmissionAllowed: false });
  });

  it.each([
    { watchlist: [] },
    { watchlist: [{ instrumentId: 'synthetic-instrument-uid', lotSize: 1, priceStep: 0.01 }] },
    { watchlist: [{ instrumentId: 'synthetic-instrument-uid', label: 'Банк ВТБ', lotSize: 1, priceStep: 0.01 }] },
    { watchlist: [{ instrumentId: 'synthetic-instrument-uid', label: 'vtbr', lotSize: 1, priceStep: 0.01 }] },
  ])('rejects an empty or unmigrated selected watchlist: %j', ({ watchlist }) => {
    expect(strategyConfigPreflight({ T_INVEST_INTRADAY_UNIVERSE: 'watchlist', T_INVEST_INTRADAY_WATCHLIST: JSON.stringify(watchlist) })).toEqual({
      configReady: false, executionMode: null, selectedStrategyId: null, liveSubmissionAllowed: false,
    });
  });

  it('keeps legacy watchlist labels irrelevant in moex-liquid mode', () => {
    expect(strategyConfigPreflight({ T_INVEST_INTRADAY_UNIVERSE: 'moex-liquid',
      T_INVEST_INTRADAY_WATCHLIST: JSON.stringify([{ instrumentId: 'synthetic-instrument-uid', lotSize: 1, priceStep: 0.01 }]),
    }).configReady).toBe(true);
  });

  it('accepts the sandbox enum without activating execution or exposing credentials', () => {
    const report = strategyConfigPreflight({ T_INVEST_EXECUTION_MODE: 'sandbox', T_INVEST_SANDBOX_TOKEN: 'sandbox-secret-marker' });
    expect(report).toEqual({ configReady: true, executionMode: 'sandbox', selectedStrategyId: 'trend-momentum-v1', liveSubmissionAllowed: false });
    expect(JSON.stringify(report)).not.toContain('sandbox-secret-marker');
  });

  it.each([
    { T_INVEST_TRADING_STRATEGY_ID: 'strategy-secret-marker' },
    { T_INVEST_EXECUTION_MODE: 'execution-secret-marker' },
    { T_INVEST_TOKEN: 'duplicate-secret-marker', T_INVEST_SANDBOX_TOKEN: 'duplicate-secret-marker' },
    { T_INVEST_LIVE_ACCOUNT_ID: 'account-secret-marker', T_INVEST_SANDBOX_ACCOUNT_ID: 'account-secret-marker' },
  ])('emits only a fixed failure report and nonzero CLI exit for invalid private environment', (invalidEnv) => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/strategy-config-preflight.ts'], {
      cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH, ...invalidEnv },
    });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({ configReady: false, executionMode: null, selectedStrategyId: null, liveSubmissionAllowed: false });
    expect(result.stderr).toBe('');
    for (const value of Object.values(invalidEnv)) expect(result.stdout + result.stderr).not.toContain(value);
  });

  it('runs preflight after build and before replacing the existing service', () => {
    const workflow = readFileSync(join(root, '.github', 'workflows', 'deploy-telegram.yml'), 'utf8');
    const build = workflow.indexOf('docker compose build --build-arg APP_REVISION="$deployment_expected_sha" telegram-service');
    const preflight = workflow.indexOf('docker compose run --rm --no-deps -T --interactive=false </dev/null --entrypoint node telegram-service dist/strategy-config-preflight.js');
    const up = workflow.indexOf('docker compose up -d --no-build --remove-orphans');
    expect(build).toBeGreaterThan(-1);
    expect(preflight).toBeGreaterThan(build);
    expect(up).toBeGreaterThan(preflight);
    expect(workflow).toContain('set -Eeuo pipefail');
    expect(workflow).toContain('git checkout --detach "$deployment_expected_sha"');
    expect(workflow.indexOf('python3 ops/verify_strategy_service.py --expected-sha "$deployment_expected_sha"')).toBeGreaterThan(up);
  });

  it.each([
    { failingStage: 'build', expectedCommands: 1 },
    { failingStage: 'preflight', expectedCommands: 2 },
  ])('keeps the old service untouched when the local $failingStage fails', ({ failingStage, expectedCommands }) => {
    const { result, commands } = runLocalDeploy(failingStage);
    expect(result.status).toBe(1);
    expect(commands).toHaveLength(expectedCommands);
    expect(commands.some(args => args[1] === 'up')).toBe(false);
    expect(commands[0]).toEqual(['compose', 'build', 'telegram-service']);
    if (failingStage === 'preflight') expect(commands[1]).toEqual([
      'compose', 'run', '--rm', '--no-deps', '--entrypoint', 'node', 'telegram-service', 'dist/strategy-config-preflight.js',
    ]);
  });

  it('replaces only telegram-service without rebuilding after a successful local preflight', () => {
    const { result, commands } = runLocalDeploy();
    expect(result.status).toBe(0);
    expect(commands).toEqual([
      ['compose', 'build', 'telegram-service'],
      ['compose', 'run', '--rm', '--no-deps', '--entrypoint', 'node', 'telegram-service', 'dist/strategy-config-preflight.js'],
      ['compose', 'up', '-d', '--no-build', 'telegram-service'],
    ]);
  });
});
