import { describe, expect, it, vi } from 'vitest';

import { liveProductionEndpoint } from './live-preflight-client.js';
import { LiveOrderClient } from './live-order-client.js';
import { TInvestOrderError } from './tinvest-order-client.js';

const requestId = 'd365f2c2-b443-4a21-9568-272e6ee3a932';

describe('LiveOrderClient', () => {
  it('posts only a limit fill-or-kill order to the production orders endpoint', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      orderId: 'broker-1', executionReportStatus: 'EXECUTION_REPORT_STATUS_FILL', lotsRequested: 5, lotsExecuted: 5,
    })));
    const result = await new LiveOrderClient('live-token', liveProductionEndpoint, fetcher).postLimitOrder({
      mode: 'live', accountId: 'daily-account', instrumentId: 'sber', lots: 5, limitPrice: 100,
      direction: 'buy', orderRequestId: requestId,
    });
    expect(result).toEqual({ brokerOrderId: 'broker-1', executionStatus: 'EXECUTION_REPORT_STATUS_FILL', lotsRequested: 5, lotsExecuted: 5 });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(`${liveProductionEndpoint}/tinkoff.public.invest.api.contract.v1.OrdersService/PostOrder`);
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
      accountId: 'daily-account', quantity: '5', direction: 'ORDER_DIRECTION_BUY',
      orderType: 'ORDER_TYPE_LIMIT', timeInForce: 'TIME_IN_FORCE_FILL_OR_KILL', confirmMarginTrade: false, orderId: requestId,
    });
    expect(fetcher.mock.calls[0]?.[1]?.redirect).toBe('error');
  });

  it('rejects the sandbox host before any request', () => {
    expect(() => new LiveOrderClient('live-token', 'https://sandbox-invest-public-api.tbank.ru/rest')).toThrow(/production/);
  });

  it('keeps a network failure uncertain and does not retry', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('private token'));
    const client = new LiveOrderClient('live-token', liveProductionEndpoint, fetcher);
    await expect(client.postLimitOrder({
      mode: 'live', accountId: 'daily-account', instrumentId: 'sber', lots: 1, limitPrice: 100,
      direction: 'buy', orderRequestId: requestId,
    })).rejects.toMatchObject({ outcomeUncertain: true });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('treats an HTTP error as an uncertain post', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('secret', { status: 500 }));
    await expect(new LiveOrderClient('live-token', liveProductionEndpoint, fetcher).postLimitOrder({
      mode: 'live', accountId: 'daily-account', instrumentId: 'sber', lots: 1, limitPrice: 100,
      direction: 'buy', orderRequestId: requestId,
    })).rejects.toBeInstanceOf(TInvestOrderError);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('places one sell stop-limit and accepts an id without echoing the request', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ stopOrderId: 'stop-1' })));
    const id = await new LiveOrderClient('live-token', liveProductionEndpoint, fetcher).postStopLimit({
      mode: 'live', accountId: 'daily-account', instrumentId: 'sber', requestId, lots: 5,
      stopNano: '99000000000', limitNano: '99000000000',
    });
    expect(id).toBe('stop-1');
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('StopOrdersService/PostStopOrder');
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
      direction: 'STOP_ORDER_DIRECTION_SELL', confirmMarginTrade: false, orderId: requestId, quantity: '5',
    });
  });
});
