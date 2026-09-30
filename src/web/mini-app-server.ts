import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { verifyTelegramInitData } from './telegram-auth.js';
import type { MiniAppView } from './mini-app-view.js';

type Dependencies = {
  token: string; origin: string; allowedPrivateIds: string[];
  view(): MiniAppView;
  action(action: 'pause' | 'resume' | 'kill'): void;
  now?: () => Date;
};

const policies = {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; script-src 'self' https://telegram.org; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; object-src 'none'; frame-ancestors https://web.telegram.org https://*.web.telegram.org",
};

async function body(request: IncomingMessage): Promise<unknown> {
  let size = 0;
  const parts: Buffer[] = [];
  for await (const chunk of request) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += part.length;
    if (size > 1024) throw new Error('Too large');
    parts.push(part);
  }
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}

export function createMiniAppServer(dependencies: Dependencies) {
  const assets = new Map([
    ['/', { type: 'text/html; charset=utf-8', bytes: readFileSync(new URL('./public/index.html', import.meta.url)) }],
    ['/app.css', { type: 'text/css; charset=utf-8', bytes: readFileSync(new URL('./public/app.css', import.meta.url)) }],
    ['/app.js', { type: 'text/javascript; charset=utf-8', bytes: readFileSync(new URL('./public/app.js', import.meta.url)) }],
  ]);
  const windows = new Map<string, { started: number; count: number }>();
  function allowedRate(key: string, now: number, maximum: number): boolean {
    for (const [entry, value] of windows) if (now - value.started >= 60_000) windows.delete(entry);
    let value = windows.get(key);
    if (!value) {
      if (windows.size >= 1000) return false;
      value = { started: now, count: 0 }; windows.set(key, value);
    }
    return ++value.count <= maximum;
  }
  function send(response: ServerResponse, status: number, payload: unknown) {
    response.writeHead(status, { ...policies, 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(payload));
  }
  async function handle(request: IncomingMessage, response: ServerResponse) {
    const path = request.url ?? '';
    const assetPath = path.split('?', 1)[0] ?? '';
    if (request.method === 'GET' && assets.has(assetPath)) {
      const asset = assets.get(assetPath)!;
      response.writeHead(200, { ...policies, 'Content-Type': asset.type }); response.end(asset.bytes); return;
    }
    if (!['/api/view', '/api/action'].includes(path)) { send(response, 404, { error: 'Not found' }); return; }
    const now = dependencies.now?.() ?? new Date();
    if (!allowedRate(`ip:${request.socket.remoteAddress ?? 'unknown'}`, now.getTime(), 120)) {
      send(response, 429, { error: 'Too many requests' }); return;
    }
    // Telegram auth never appears in the URL, cookies, logs or responses.
    const auth = request.headers.authorization;
    const id = typeof auth === 'string' && auth.startsWith('tma ')
      ? verifyTelegramInitData(auth.slice(4), dependencies.token, dependencies.allowedPrivateIds, now) : null;
    if (!id) { send(response, 401, { error: 'Open this Mini App from an authorized Telegram chat' }); return; }
    if (!allowedRate(`user:${id}`, now.getTime(), 60)) { send(response, 429, { error: 'Too many requests' }); return; }
    if (path === '/api/view' && request.method === 'GET') { send(response, 200, dependencies.view()); return; }
    if (path !== '/api/action' || request.method !== 'POST') { send(response, 405, { error: 'Method not allowed' }); return; }
    if (request.headers.origin !== dependencies.origin
      || !/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) {
      send(response, 403, { error: 'Request origin or content type is not permitted' }); return;
    }
    if (Number(request.headers['content-length']) > 1024) {
      request.resume(); send(response, 413, { error: 'Request body is too large' }); return;
    }
    const value = await body(request).catch(() => null) as { action?: unknown } | null;
    if (!value || typeof value.action !== 'string' || !['pause', 'resume', 'kill'].includes(value.action)) {
      send(response, 400, { error: 'Unsupported action' }); return;
    }
    dependencies.action(value.action as 'pause' | 'resume' | 'kill');
    send(response, 200, dependencies.view());
  }
  const server = createServer((request, response) => {
    void handle(request, response).catch(() => { if (!response.headersSent) send(response, 500, { error: 'Request failed' }); else response.end(); });
  });
  server.requestTimeout = 15_000; server.headersTimeout = 10_000; server.maxHeadersCount = 40;
  return server;
}
