import { request } from 'node:http';

/** HTTP inside the authenticated SSH stream. Only a fixed private socket is supported. */
export function createUnixRelayFetch(socketPath: string): typeof fetch {
  if (socketPath !== '/run/relay/market.sock') throw new Error('Invalid private relay socket');
  return async (input, init) => {
    if (typeof input !== 'string' && !(input instanceof URL)) throw new Error('Invalid relay URL');
    const url = new URL(input);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !['/market-data', '/egress'].includes(url.pathname)
      || url.search || url.hash || url.username || url.password) throw new Error('Invalid relay request');
    return new Promise<Response>((resolve, reject) => {
      const signal = init?.signal ?? AbortSignal.timeout(20_000);
      const headers = Object.fromEntries(new Headers(init?.headers).entries());
      const req = request({ socketPath, path: url.pathname, method: init?.method ?? 'GET', headers, signal: signal ?? undefined }, res => {
        const chunks: Buffer[] = []; let length = 0;
        res.on('data', (chunk: Buffer) => {
          length += chunk.length;
          if (length > 4_000_000) { res.destroy(new Error('Relay response too large')); return; }
          chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () => {
          const status = res.statusCode ?? 502;
          if (status >= 300 && status < 400) { reject(new Error('Relay redirects are forbidden')); return; }
          try { resolve(new Response(Buffer.concat(chunks), { status })); }
          catch { reject(new Error('Invalid relay response')); }
        });
      });
      req.on('error', reject);
      if (init?.body !== undefined && init.body !== null && typeof init.body !== 'string') { req.destroy(); reject(new Error('Invalid relay body')); return; }
      req.end(init?.body);
    });
  };
}
