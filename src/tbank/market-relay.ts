import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod/v4';
import { readEgressLocation } from './egress-location.js';

const prefix = 'tinkoff.public.invest.api.contract.v1.';
export const marketRelayMethods = [
  prefix + 'InstrumentsService/Shares',
  prefix + 'MarketDataService/GetCandles',
  prefix + 'MarketDataService/GetOrderBook',
  prefix + 'MarketDataService/GetLastPrices',
  prefix + 'MarketDataService/GetTradingStatus',
] as const;
const schema = z.object({ method: z.enum(marketRelayMethods), body: z.record(z.string(), z.unknown()) }).strict();
export function parseMarketRelayRequest(value: unknown) { return schema.parse(value); }

/** Market data only. Never accepts a broker token, URL, account or trading method from the caller. */
export function createMarketRelay(options: { secret: string; readToken: string; fetchImpl?: typeof fetch }) {
  if (options.secret.length < 32 || !options.readToken) throw new Error('Relay credentials are required');
  const expected = Buffer.from('Bearer ' + options.secret);
  let windowStarted = Date.now(); let count = 0; let inFlight = 0;
  let location: Awaited<ReturnType<typeof readEgressLocation>> | null = null;
  let locationRequest: Promise<Awaited<ReturnType<typeof readEgressLocation>>> | null = null;
  const server = createServer((request, response) => {
    const send = (status: number, value: unknown) => {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(value));
    };
    const handle = async () => {
      const supplied = Buffer.from(request.headers.authorization ?? '');
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { send(401, { error: 'Unauthorized' }); return; }
      if (Date.now() - windowStarted >= 60_000) { windowStarted = Date.now(); count = 0; }
      if (++count > 120 || inFlight >= 4) { send(429, { error: 'Busy' }); return; }
      if (request.method === 'GET' && request.url === '/egress') {
        if (!location || Date.now() - Date.parse(location.checkedAt) >= 3_600_000) {
          locationRequest ??= readEgressLocation(options.fetchImpl);
          try { location = await locationRequest; } finally { locationRequest = null; }
        }
        send(200, location); return;
      }
      if (request.method !== 'POST' || request.url !== '/market-data') { send(404, { error: 'Not found' }); return; }
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) { send(400, { error: 'Invalid request' }); return; }
      const chunks: Buffer[] = []; let size = 0;
      for await (const raw of request) {
        const chunk = Buffer.from(raw); size += chunk.length;
        if (size > 8192) { send(413, { error: 'Too large' }); return; }
        chunks.push(chunk);
      }
      let value: ReturnType<typeof parseMarketRelayRequest>;
      try { value = parseMarketRelayRequest(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { send(400, { error: 'Unsupported request' }); return; }
      // Reserve synchronously after reading the body: concurrent slow uploads cannot exceed the cap.
      if (inFlight >= 4) { send(429, { error: 'Busy' }); return; }
      inFlight++;
      try {
        const result = await (options.fetchImpl ?? fetch)('https://invest-public-api.tbank.ru/rest/' + value.method, {
          method: 'POST', headers: { Authorization: 'Bearer ' + options.readToken, 'Content-Type': 'application/json' },
          body: JSON.stringify(value.body), redirect: 'error', signal: AbortSignal.timeout(15_000),
        });
        if (!result.ok) { send(502, { error: 'Broker unavailable' }); return; }
        const text = await result.text();
        if (text.length > 4_000_000) throw new Error();
        send(200, JSON.parse(text));
      } finally { inFlight--; }
    };
    void handle().catch(() => { if (!response.headersSent) send(502, { error: 'Relay unavailable' }); else response.end(); });
  });
  server.requestTimeout = 20_000; server.headersTimeout = 10_000; server.maxHeadersCount = 30;
  return server;
}
