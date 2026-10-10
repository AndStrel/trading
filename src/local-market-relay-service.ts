import { readFileSync } from 'node:fs';
import { createMarketRelay } from './tbank/market-relay.js';

// The container is published on host loopback only. No Telegram token or trading credential is loaded.
try {
  const snapshot = JSON.parse(readFileSync('/run/private/snapshot.json', 'utf8')) as { env?: { T_INVEST_TOKEN?: unknown } };
  const token = snapshot.env?.T_INVEST_TOKEN;
  if (typeof token !== 'string' || !token.trim()) throw new Error();
  const secret = readFileSync('/run/private/relay-secret', 'utf8').trim();
  const server = createMarketRelay({ readToken: token, secret });
  server.on('error', () => { process.stderr.write('Local market relay unavailable\n'); process.exitCode = 1; });
  server.listen(13877, '0.0.0.0', () => process.stdout.write('{"event":"local-market-relay-ready","brokerWrites":false}\n'));
} catch {
  process.stderr.write('Local market relay private configuration unavailable\n');
  process.exitCode = 1;
}
