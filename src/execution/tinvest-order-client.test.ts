import { describe, expect, it, vi } from 'vitest';

import { TInvestOrderClient, TInvestOrderError } from './tinvest-order-client.js';

const input = {
  mode: 'sandbox' as const,
  accountId: 'sandbox-account',
  instrumentId: 'instrument-uid',
  lots: 3,
  limitPrice: 285.67,
  direction: 'buy' as const,
  orderRequestId: 'd365f2c2-b443-4a21-9568-272e6ee3a932',
};

describe('TInvestOrderClient', () => {
  it('looks up sandbox state by the persisted request UUID, never placing another order', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'));
    const client = new TInvestOrderClient('local-secret', 'https://example.test/rest', fetcher);
    await client.getSandboxOrderState('local-account', input.orderRequestId);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://example.test/rest/tinkoff.public.invest.api.contract.v1.SandboxService/GetSandboxOrderState');
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({ accountId: 'local-account',
      orderId: input.orderRequestId, orderIdType: 'ORDER_ID_TYPE_REQUEST', priceType: 'PRICE_TYPE_CURRENCY' });
  });
  it.each([400, 401, 403, 404, 408, 409, 422, 429, 500, 502, 503])('does not release risk on HTTP %s alone', async status => {
    const client = new TInvestOrderClient('secret', 'https://example.test/rest', vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status })));
    await expect(client.postLimitOrder(input)).rejects.toMatchObject({ outcomeUncertain: true });
  });
  it('does not interpret a malformed fill count as zero executed lots', async () => {
    const client = new TInvestOrderClient('secret', 'https://example.test/rest', vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ orderId: 'order', executionReportStatus: 'EXECUTION_REPORT_STATUS_CANCELLED', lotsRequested: '3' }))));
    await expect(client.postLimitOrder(input)).rejects.toMatchObject({ outcomeUncertain: true });
  });
  it('posts only a non-margin FOK limit order to the sandbox endpoint', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          orderId: 'broker-order',
          executionReportStatus: 'EXECUTION_REPORT_STATUS_FILL',
          lotsRequested: '3',
          lotsExecuted: '3',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const client = new TInvestOrderClient('trading-secret', 'https://example.test/rest', fetchMock);

    await expect(client.postLimitOrder(input)).resolves.toEqual({
      brokerOrderId: 'broker-order',
      executionStatus: 'EXECUTION_REPORT_STATUS_FILL',
      lotsRequested: 3,
      lotsExecuted: 3,
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(
      'https://example.test/rest/tinkoff.public.invest.api.contract.v1.SandboxService/PostSandboxOrder',
    );
    expect(init).toEqual(
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer trading-secret' }),
      }),
    );
    expect(JSON.parse(String(init?.body))).toEqual(
      expect.objectContaining({
        instrumentId: 'instrument-uid',
        quantity: 3,
        price: { units: '285', nano: 670000000 },
        direction: 'ORDER_DIRECTION_BUY',
        accountId: 'sandbox-account',
        orderType: 'ORDER_TYPE_LIMIT',
        orderId: input.orderRequestId,
        timeInForce: 'TIME_IN_FORCE_FILL_OR_KILL',
        priceType: 'PRICE_TYPE_CURRENCY',
        confirmMarginTrade: false,
      }),
    );
  });

  it('marks a network failure as an uncertain broker outcome', async () => {
    const client = new TInvestOrderClient(
      'secret',
      'https://example.test/rest',
      vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed')),
    );

    await client.postLimitOrder(input).catch((error: unknown) => {
      expect(error).toBeInstanceOf(TInvestOrderError);
      expect((error as TInvestOrderError).outcomeUncertain).toBe(true);
      expect(String(error)).not.toContain('secret');
    });
  });

  it('does not expose broker messages or treat HTTP validation as proof of no order', async () => {
    const client = new TInvestOrderClient(
      'secret',
      'https://example.test/rest',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ message: 'invalid order' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await client.postLimitOrder(input).catch((error: unknown) => {
      expect(error).toBeInstanceOf(TInvestOrderError);
      expect((error as TInvestOrderError).outcomeUncertain).toBe(true);
      expect(String(error)).not.toContain('invalid order');
    });
  });
});
