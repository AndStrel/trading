import { loadConfig } from './config.js';
import { TInvestClient } from './tbank/client.js';

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.token) {
    throw new Error('T_INVEST_TOKEN is required for the manual smoke test');
  }

  const client = new TInvestClient(config.token, config.baseUrl);
  await client.getAccounts();

  console.error('T-Invest read-only authentication smoke test passed');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown smoke-test error';
  console.error(`T-Invest smoke test failed: ${message}`);
  process.exitCode = 1;
});
