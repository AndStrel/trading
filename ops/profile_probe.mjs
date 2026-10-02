// Called privately by the fixed maintenance command; stdout must never reach CI logs.
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig } from '/app/dist/config.js';
import { readPreparedSandbox } from '/app/dist/execution/sandbox-prepared-account.js';

let stage = 'config';
try {
const candidate = process.argv.includes('--candidate');
const env = candidate ? JSON.parse(readFileSync(0, 'utf8')) : process.env;
const config = loadConfig(env);
let state;
if (!candidate) {
  stage = 'sqlite';
  const db = new DatabaseSync(config.journalPath, { readOnly: true });
  try {
    const keys = ['execution.kill_switch', 'execution.kill_generation',
      'execution.sandbox_bootstrap_v1', 'execution.sandbox_account_id'];
    state = Object.fromEntries(keys.map(key => [key,
      db.prepare('SELECT value FROM runtime_state WHERE key=?').get(key)?.value ?? null]));
    state.unresolved = db.prepare(
      "SELECT COUNT(*) AS n FROM execution_orders WHERE status IN ('submitting','accepted')"
    ).get().n;
    stage = 'ack';
    readPreparedSandbox(state['execution.sandbox_bootstrap_v1'],
      state['execution.sandbox_account_id'], config.execution.accountId);
  } finally { db.close(); }
}
process.stdout.write(JSON.stringify({ env, config, ...(state ? { state } : {}) }));
} catch {
  // Fixed public error categories only, never exception text or private values.
  process.stdout.write(JSON.stringify({ probeFailure: stage }));
  process.exitCode = 1;
}
