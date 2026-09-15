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

  it('marks a broker validation response as a certain rejection', async () => {
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
      expect((error as TInvestOrderError).outcomeUncertain).toBe(false);
      expect(String(error)).toContain('invalid order');
    });
  });
});
