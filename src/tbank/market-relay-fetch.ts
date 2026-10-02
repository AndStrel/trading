import { marketRelayMethods } from './market-relay.js';

/** A fixed market-data source: no fallback and no broker credentials leave the caller. */
export function createMarketRelayFetch(options: { url: string; secret: string; fetchImpl?: typeof fetch }): typeof fetch {
  const endpoint = new URL(options.url);
  if (endpoint.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(endpoint.hostname)
    || endpoint.pathname !== '/market-data' || endpoint.search || endpoint.hash
    || endpoint.username || endpoint.password || options.secret.length < 32) {
    throw new Error('Relay requires an authenticated loopback tunnel');
  }
  return async (input, init) => {
    if (typeof input !== 'string' && !(input instanceof URL)) throw new Error('Unsupported market request');
    const url = new URL(input);
    const method = url.pathname.replace(/^\/rest\//, '');
    if (url.origin !== 'https://invest-public-api.tbank.ru' || url.search || url.hash
      || url.username || url.password || init?.method !== 'POST'
      || !marketRelayMethods.some(allowed => allowed === method) || typeof init.body !== 'string') {
      throw new Error('Only whitelisted market data can use the local relay');
    }
    let body: unknown;
    try { body = JSON.parse(init.body); } catch { throw new Error('Invalid market payload'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid market payload');
    // Deliberately rebuild all headers: never forward the production Authorization header.
    return (options.fetchImpl ?? fetch)(endpoint.href, {
      method: 'POST', headers: { Authorization: 'Bearer ' + options.secret, 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, body }), redirect: 'error',
      signal: init.signal ?? AbortSignal.timeout(20_000),
    });
  };
}
