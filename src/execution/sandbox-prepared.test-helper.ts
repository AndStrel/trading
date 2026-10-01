import type { ScenarioJournal } from '../journal/scenario-journal.js';
import { sandboxAccountKey, sandboxBootstrapKey, sandboxEndpoint } from './sandbox-prepared-account.js';

// Synthetic fixture only; no real broker identifier or credential.
export function seedPreparedSandbox(journal: ScenarioJournal, accountId: string) {
  const nonce = '00000000-0000-4000-8000-000000000001';
  const state = { version: 1, endpoint: sandboxEndpoint, nonce, name: `daily-pilot-${nonce}`, phase: 'ready', accountId };
  journal.setRuntimeState(sandboxBootstrapKey, JSON.stringify(state));
  journal.setRuntimeState(sandboxAccountKey, accountId);
  return state;
}
