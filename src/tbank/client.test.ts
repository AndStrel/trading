import { describe, expect, it, vi } from 'vitest';

import { TInvestClient } from './client.js';

describe('TInvestClient', () => {
  it('requires a token before making a request', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = new TInvestClient(undefined, 'https://example.test/rest', fetchMock);

    await expect(client.getAccounts()).rejects.toThrow('T_INVEST_TOKEN is not configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends authorized requests to the documented REST method', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ accounts: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = new TInvestClient('secret', 'https://example.test/rest', fetchMock);

    await expect(client.getAccounts()).resolves.toEqual({ accounts: [] });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.test/rest/tinkoff.public.invest.api.contract.v1.UsersService/GetAccounts',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer secret' }),
        body: '{}',
      }),
    );
  });

  it('reports the underlying network error without exposing credentials', async () => {
    const cause = Object.assign(new Error('connection reset by peer'), { code: 'ECONNRESET' });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError('fetch failed', { cause }));
    const client = new TInvestClient('secret-token', 'https://example.test/rest', fetchMock);

    await expect(client.getAccounts()).rejects.toThrow(
      'T-Invest network error: ECONNRESET: connection reset by peer',
    );
    await client.getAccounts().catch((error: unknown) => {
      expect(String(error)).not.toContain('secret-token');
    });
  });
});
