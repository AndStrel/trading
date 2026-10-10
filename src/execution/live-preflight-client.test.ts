import { describe, expect, it, vi } from 'vitest';

import { LivePreflightClient } from './live-preflight-client.js';

const endpoint = 'https://invest-public-api.tbank.ru/rest';
describe('isolated live preflight transport', () => {
  it('only exposes read requests and never submits, cancels, funds or creates stops', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => new Response('{}'));
    const client = new LivePreflightClient('live-secret', endpoint, 'fetch', fetchMock);
    await client.getAccounts(); await client.getUserInfo(); await client.getPositions('daily');
    await client.getOrders('daily'); await client.getStopOrders('daily'); await client.getShare('uid');
    await client.getOrderPrice('daily', 'uid', 100, 1, 'buy');
    expect(fetchMock.mock.calls.map(([url]) => String(url).split('/').at(-1))).toEqual([
      'GetAccounts', 'GetInfo', 'GetPositions', 'GetOrders', 'GetStopOrders', 'ShareBy', 'GetOrderPrice',
    ]);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.redirect).toBe('error');
      expect(init?.headers).toEqual({ Authorization: 'Bearer live-secret', 'Content-Type': 'application/json' });
    }
    const prototype = Object.getOwnPropertyNames(LivePreflightClient.prototype);
    expect(prototype).not.toContain('postLimitOrder');
    expect(prototype).not.toContain('cancelOrder');
  });
  it.each(['http://invest-public-api.tbank.ru/rest', 'https://example.test/rest', 'https://secret@invest-public-api.tbank.ru/rest', endpoint + '?token=secret'])('rejects an untrusted endpoint %s', url => {
    expect(() => new LivePreflightClient('secret', url)).toThrow('HTTPS endpoint');
  });
  it('does not request anything without a separate token', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    await expect(new LivePreflightClient(undefined, endpoint, 'fetch', fetchMock).getAccounts()).rejects.toThrow('not configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('never reflects broker errors containing identifiers or credentials', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('sensitive account and token', { status: 500 }));
    await expect(new LivePreflightClient('secret', endpoint, 'fetch', fetchMock).getOrders('private-account')).rejects.toThrow('GetOrders failed; no order was sent');
  });
});
