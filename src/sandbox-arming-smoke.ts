import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from './config.js';
import { ScenarioJournal } from './journal/scenario-journal.js';
import { ExecutionService } from './execution/execution-service.js';
import { sandboxBootstrapKey, sandboxEndpoint } from './execution/sandbox-prepared-account.js';
import { seedPreparedSandbox } from './execution/sandbox-prepared.test-helper.js';

// Synthetic, network-free verification of the compiled runtime. Never loads
// process.env, server journals, account credentials or any real broker client.
const directory = mkdtempSync(join(tmpdir(), 'trading-arm-smoke-'));
try {
  const journal = new ScenarioJournal(join(directory, 'journal.sqlite'));
  const config = loadConfig({ T_INVEST_EXECUTION_MODE: 'sandbox', T_INVEST_TRADING_TOKEN: 'synthetic-smoke-token',
    T_INVEST_SANDBOX_ACCOUNT_ID: 'synthetic-smoke-account' });
  assert.equal(config.baseUrl, 'https://invest-public-api.tbank.ru/rest');
  assert.equal(config.execution.baseUrl, sandboxEndpoint);
  const state = seedPreparedSandbox(journal, 'synthetic-smoke-account');
  const uncertain = JSON.stringify({ ...state, phase: 'open-claimed', accountId: null });
  journal.setRuntimeState(sandboxBootstrapKey, uncertain);
  let reads = 0; let writes = 0; let killDuringRead = false;
  const forbidden = async (): Promise<never> => { writes++; throw new Error('Broker writes are forbidden in arming smoke'); };
  const read = () => { reads++; assert.equal(journal.isExecutionKilled(), true); };
  const client = {
    getSandboxAccounts: async () => { read(); return [{ id: state.accountId, name: state.name }]; },
    getSandboxOrders: async () => { read(); return { orders: [] }; },
    getSandboxStopOrders: async () => { read(); return { stopOrders: [] }; },
    getSandboxPositions: async (accountId: string) => {
      read(); if (killDuringRead) journal.setExecutionKilled(true);
      return { accountId, limitsLoadingInProgress: false, money: [{ currency: 'rub', units: '1000', nano: 0 }],
        blocked: [], securities: [], futures: [], options: [] };
    },
    postLimitOrder: forbidden, getSandboxOrderState: forbidden,
    openSandboxAccount: forbidden, sandboxPayIn: forbidden,
  };
  const service = new ExecutionService(config, { getOrderBook: forbidden, getTradingStatus: forbidden }, client, journal);
  await assert.rejects(service.armSandbox(), /not confirmed/);
  assert.equal(journal.getRuntimeState(sandboxBootstrapKey), uncertain);
  assert.equal(journal.isExecutionKilled(), true); assert.equal(reads, 0); assert.equal(writes, 0);

  seedPreparedSandbox(journal, state.accountId);
  await service.armSandbox();
  assert.equal(journal.isExecutionKilled(), false); assert.equal(reads, 4); assert.equal(writes, 0);

  killDuringRead = true;
  await assert.rejects(service.armSandbox(), /not confirmed/);
  assert.equal(journal.isExecutionKilled(), true); assert.equal(reads, 8); assert.equal(writes, 0);
  console.log('Compiled sandbox arming smoke passed: uncertain state preserved, prepared account read only, concurrent kill preserved, zero broker writes');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
