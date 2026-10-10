import { once } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { createMiniAppServer } from './mini-app-server.js';
import { signedData } from './telegram-auth.fixture.js';
import type { MiniAppView } from './mini-app-view.js';

const servers: Server[] = [];
const now = new Date('2026-09-30T19:00:00Z');
const view: MiniAppView = { observedAt: now.toISOString(), scanner: { paused: false, lastScanAt: null, fresh: false, scanned: 0, errors: 0 },
  execution: { mode: 'disabled', killed: true, liveSubmissionAllowed: false, actualPnlRub: null, lossMonitorReady: false },
  sandboxLossGuard: { state: 'off', checkedAt: null, closedLoss: null, estimatedOpenLoss: null, totalLoss: null },
  limits: { capitalRub: 1000, tradeRiskRub: 20, dailyRiskRub: 60, dailyLossRub: 60, positionRub: 996.51, commissionRate: 0.003, slippageRate: 0.0005 }, candidates: [], sandboxResults: [] };
async function start(selectMarketSource?: (source: 'server' | 'computer') => void,
  trading?: Pick<Parameters<typeof createMiniAppServer>[0], 'selectTradingStrategy' | 'selectTradingAssets'> & { view?: () => MiniAppView }) {
  const action = vi.fn();
  const server = createMiniAppServer({ token: 'test-bot-token', origin: 'https://bot.brewnote.net', allowedPrivateIds: ['42'],
    view: trading?.view ?? (() => view), action, now: () => now, ...(selectMarketSource ? { selectMarketSource } : {}),
    ...(trading?.selectTradingStrategy ? { selectTradingStrategy: trading.selectTradingStrategy } : {}),
    ...(trading?.selectTradingAssets ? { selectTradingAssets: trading.selectTradingAssets } : {}) });
  servers.push(server); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test address');
  return { url: `http://127.0.0.1:${address.port}`, action };
}
afterEach(async () => {
  for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
const headers = { Authorization: 'tma ' + signedData() };
describe('Mini App HTTP boundary', () => {
  it('requires authentication, exact payloads and a current revision for strategy and asset changes', async () => {
    const selection = { strategyId: 'trend-momentum-v1' as const, revision: 5, tickers: ['VTBR'] };
    let current: MiniAppView = { ...view, tradingSelection: selection, availableTickers: ['VTBR', 'SBER'] };
    const strategy = vi.fn((strategyId: string, revision: number) => {
      current = { ...current, tradingSelection: { strategyId: strategyId as 'vwap-reclaim-v1', revision: revision + 1, tickers: ['VTBR'] } };
    });
    const assets = vi.fn();
    const { url, action } = await start(undefined, { view: () => current, selectTradingStrategy: strategy, selectTradingAssets: assets });
    const post = (value: unknown, authorized = true) => fetch(url + '/api/action', { method: 'POST',
      headers: { ...(authorized ? headers : {}), Origin: 'https://bot.brewnote.net', 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    const valid = { action: 'strategy-select', strategyId: 'vwap-reclaim-v1', expectedRevision: 5 };
    expect((await post(valid, false)).status).toBe(401); expect(strategy).not.toHaveBeenCalled();
    for (const invalid of [{ ...valid, expectedRevision: '5' }, { ...valid, expectedRevision: -1 },
      { ...valid, expectedRevision: 5.5 }, { ...valid, strategyId: 'buy' }, { ...valid, accountId: 'private' },
      { action: 'assets-select', tickers: [], expectedRevision: 5 },
      { action: 'assets-select', tickers: ['VTBR', 'VTBR'], expectedRevision: 5 },
      { action: 'assets-select', tickers: ['unknown-token'], expectedRevision: 5 }]) {
      expect((await post(invalid)).status).toBe(400);
    }
    expect(strategy).not.toHaveBeenCalled(); expect(assets).not.toHaveBeenCalled();
    expect((await post(valid)).status).toBe(200); expect(strategy).toHaveBeenCalledExactlyOnceWith('vwap-reclaim-v1', 5);
    expect((await post(valid)).status).toBe(409); expect(strategy).toHaveBeenCalledTimes(1);
    expect((await post({ action: 'assets-select', tickers: ['GAZP'], expectedRevision: 6 })).status).toBe(400);
    const selected = await post({ action: 'assets-select', tickers: ['VTBR', 'SBER'], expectedRevision: 6 });
    expect(selected.status).toBe(200); expect(assets).toHaveBeenCalledExactlyOnceWith(['VTBR', 'SBER'], 6);
    assets.mockImplementationOnce(() => { throw new Error('private-lock-detail'); });
    const rejected = await post({ action: 'assets-select', tickers: ['VTBR'], expectedRevision: 6 });
    expect(rejected.status).toBe(409); expect(await rejected.text()).not.toContain('private-lock-detail');
    expect(action).not.toHaveBeenCalled();
  });
  it('refuses selection changes when the integration has no selection controller', async () => {
    const { url, action } = await start();
    const response = await fetch(url + '/api/action', { method: 'POST', headers: { ...headers,
      Origin: 'https://bot.brewnote.net', 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'strategy-select', strategyId: 'vwap-reclaim-v1', expectedRevision: 1 }) });
    expect(response.status).toBe(409); expect(action).not.toHaveBeenCalled();
  });
  it('keeps source selection authenticated and separate from execution controls', async () => {
    const select = vi.fn(); const { url, action } = await start(select);
    const request = { method: 'POST', headers: { ...headers, Origin: 'https://bot.brewnote.net', 'Content-Type': 'application/json' }, body: '{"action":"source-computer"}' };
    expect((await fetch(url + '/api/action', { ...request, headers: { Origin: 'https://bot.brewnote.net', 'Content-Type': 'application/json' } })).status).toBe(401);
    expect(select).not.toHaveBeenCalled();
    expect((await fetch(url + '/api/action', request)).status).toBe(200);
    expect(select).toHaveBeenCalledWith('computer'); expect(action).not.toHaveBeenCalled();
    select.mockImplementationOnce(() => { throw new Error('synthetic-private-unavailable'); });
    const refused = await fetch(url + '/api/action', request);
    expect(refused.status).toBe(409); expect(await refused.text()).not.toContain('synthetic-private');
  });
  it('serves only a public shell, with no private data or tokens, and denies unauthenticated API access', async () => {
    const { url, action } = await start();
    const response = await fetch(url + '/?tgWebAppStartParam=test');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors https://web.telegram.org");
    const html = await response.text();
    expect(html).toContain('Trading'); expect(html).not.toContain('test-bot-token'); expect(html).not.toContain('996.51');
    expect((await fetch(url + '/api/view')).status).toBe(401);
    expect((await fetch(url + '/api/view', { headers: { Authorization: 'tma forged' } })).status).toBe(401);
    expect((await fetch(url + '/api/view', { headers: { Authorization: 'tma ' + signedData('test-bot-token', { user: JSON.stringify({ id: 7 }) }) } })).status).toBe(401);
    expect(action).not.toHaveBeenCalled();
  });
  it('returns only whitelisted state for an authenticated user', async () => {
    const { url } = await start();
    const response = await fetch(url + '/api/view', { headers });
    expect(response.status).toBe(200); expect(await response.json()).toEqual(view);
    expect((await fetch(url + '/api/view?initData=ignored', { headers })).status).toBe(404);
    expect((await fetch(url + '/.env')).status).toBe(404);
  });
  it('requires exact origin/content type and refuses trading actions or malformed bodies', async () => {
    const { url, action } = await start();
    for (const candidate of ['buy', 'sell', 'arm', ['pause'], 1, null]) {
      const response = await fetch(url + '/api/action', { method: 'POST', headers: { ...headers, Origin: 'https://bot.brewnote.net', 'Content-Type': 'application/json' }, body: JSON.stringify({ action: candidate }) });
      expect(response.status).toBe(400);
    }
    for (const extra of [{ Origin: 'https://evil.example', 'Content-Type': 'application/json' }, { Origin: 'https://bot.brewnote.net', 'Content-Type': 'application/jsonx' }, { 'Content-Type': 'application/json' }]) {
      expect((await fetch(url + '/api/action', { method: 'POST', headers: { ...headers, ...extra }, body: '{"action":"kill"}' })).status).toBe(403);
    }
    expect(action).not.toHaveBeenCalled();
    expect((await fetch(url + '/api/action', { method: 'POST', headers: { ...headers, Origin: 'https://bot.brewnote.net', 'Content-Type': 'application/json' }, body: 'x'.repeat(1025) })).status).toBe(413);
  });
  it('allows only idempotent pause/resume/kill controls and limits repeated requests', async () => {
    const { url, action } = await start();
    for (const name of ['pause', 'resume', 'kill']) {
      const response = await fetch(url + '/api/action', { method: 'POST', headers: { ...headers, Origin: 'https://bot.brewnote.net', 'Content-Type': 'application/json' }, body: JSON.stringify({ action: name }) });
      expect(response.status).toBe(200); expect(action).toHaveBeenLastCalledWith(name);
    }
    for (let index = 0; index < 57; index++) expect((await fetch(url + '/api/view', { headers })).status).toBe(200);
    expect((await fetch(url + '/api/view', { headers })).status).toBe(429);
    expect(action).toHaveBeenCalledTimes(3);
  });
});
