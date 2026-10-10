import { describe, expect, it, vi } from 'vitest';

import { TInvestOrderClient, TInvestOrderError } from './tinvest-order-client.js';
import { sandboxEndpoint } from './sandbox-prepared-account.js';

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
  const cashFrom = '2026-10-03T07:00:00.000Z', cashTo = '2026-10-03T07:10:00.000Z';
  it('reads every cash cursor page without filtering fees, pending states or other account flows', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ hasNext: true, nextCursor: 'cursor-1', items: [{ id: 'synthetic-1' }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ hasNext: false, nextCursor: '', items: [{ id: 'synthetic-2' }] })));
    const window = await new TInvestOrderClient('isolated', sandboxEndpoint, fetcher)
      .getSandboxCashOperationsWindow('synthetic-account', cashFrom, cashTo);
    expect(window.pages).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.map(call => JSON.parse(String(call[1]?.body)))).toEqual([
      { accountId: 'synthetic-account', from: cashFrom, to: cashTo, limit: 100,
        withoutCommissions: false, withoutTrades: false, withoutOvernights: false },
      { accountId: 'synthetic-account', from: cashFrom, to: cashTo, cursor: 'cursor-1', limit: 100,
        withoutCommissions: false, withoutTrades: false, withoutOvernights: false },
    ]);
    expect(fetcher.mock.calls.every(call => String(call[0]).endsWith('SandboxService/GetSandboxOperationsByCursor') && call[1]?.redirect === 'error')).toBe(true);
  });
  it.each(['missing-next', 'missing-has-next', 'duplicate-operation', 'cursor-cycle', 'http', 'invalid-json'])
    ('fails closed on %s cash coverage with no retry', async failure => {
      const fetcher = vi.fn<typeof fetch>();
      const first = { hasNext: true, nextCursor: 'cursor-1', items: [{ id: 'synthetic-1' }] };
      if (failure === 'http') fetcher.mockResolvedValue(new Response('private secret', { status: 500 }));
      else if (failure === 'invalid-json') fetcher.mockResolvedValue(new Response('private secret'));
      else if (failure === 'missing-next') fetcher.mockResolvedValue(new Response(JSON.stringify({ hasNext: false, items: [] })));
      else if (failure === 'missing-has-next') fetcher.mockResolvedValue(new Response(JSON.stringify({ nextCursor: '', items: [] })));
      else fetcher.mockResolvedValueOnce(new Response(JSON.stringify(first)))
        .mockResolvedValue(new Response(JSON.stringify(failure === 'duplicate-operation'
          ? { hasNext: false, nextCursor: '', items: first.items } : { hasNext: true, nextCursor: 'cursor-1', items: [{ id: 'synthetic-2' }] })));
      await expect(new TInvestOrderClient('isolated', sandboxEndpoint, fetcher)
        .getSandboxCashOperationsWindow('synthetic-account', cashFrom, cashTo)).rejects.toThrow('coverage is not confirmed');
      expect(fetcher.mock.calls.length).toBeLessThanOrEqual(2);
    });
  it('never issues an eleventh cash cursor request', async () => {
    let page = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({ hasNext: true,
      nextCursor: `cursor-${++page}`, items: [{ id: `synthetic-${page}` }] })));
    await expect(new TInvestOrderClient('isolated', sandboxEndpoint, fetcher)
      .getSandboxCashOperationsWindow('synthetic-account', cashFrom, cashTo)).rejects.toThrow('coverage');
    expect(fetcher).toHaveBeenCalledTimes(10);
  });
  it('rejects an oversized streaming cash response before JSON parsing', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(' '.repeat(1_048_577)));
    await expect(new TInvestOrderClient('isolated', sandboxEndpoint, fetcher)
      .getSandboxCashOperationsWindow('synthetic-account', cashFrom, cashTo)).rejects.toThrow('coverage');
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('enforces the total cash cursor deadline after an awaited body read', async () => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      clock.mockReturnValue(30_001);
      return new Response(JSON.stringify({ hasNext: false, nextCursor: '', items: [] }));
    });
    try {
      await expect(new TInvestOrderClient('isolated', sandboxEndpoint, fetcher)
        .getSandboxCashOperationsWindow('synthetic-account', cashFrom, cashTo)).rejects.toThrow('coverage');
      expect(fetcher).toHaveBeenCalledOnce();
    } finally { clock.mockRestore(); }
  });
  it.each(['oversized', 'elapsed'])('settles a %s failure even when stream cancellation never acknowledges', async failure => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode(failure === 'oversized' ? ' '.repeat(1_048_577) : '{}'));
    }, cancel });
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      if (failure === 'elapsed') clock.mockReturnValue(30_001);
      return new Response(stream);
    });
    try {
      await expect(new TInvestOrderClient('isolated', sandboxEndpoint, fetcher)
        .getSandboxCashOperationsWindow('synthetic-account', cashFrom, cashTo)).rejects.toThrow('coverage is not confirmed');
      expect(cancel).toHaveBeenCalledOnce(); expect(fetcher).toHaveBeenCalledOnce();
    } finally { clock.mockRestore(); }
  });
  it.each(['fetch', 'read', 'system-transport'])('independently times out a hung %s that ignores abort signals', async failure => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const stream = new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => {}), cancel });
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => failure === 'fetch'
      ? new Promise<Response>(() => {}) : Promise.resolve(new Response(stream)));
    const boundedCurl = vi.fn(() => new Promise<{ status: number; body: string }>(() => {}));
    const client = new TInvestOrderClient('isolated', sandboxEndpoint, fetcher,
      failure === 'system-transport' ? { transport: 'system-curl', boundedCurlPost: boundedCurl } : {});
    let settled = false;
    const result = client.getSandboxCashOperationsWindow('synthetic-account', cashFrom, cashTo)
      .then(() => { settled = true; return 'unexpected-success'; }, (error: unknown) => {
        settled = true; return error instanceof Error ? error.message : 'unexpected-error';
      });
    try {
      await vi.advanceTimersByTimeAsync(29_999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await result).toBe('Sandbox cash operations coverage is not confirmed');
      expect(settled).toBe(true);
      if (failure === 'system-transport') { expect(fetcher).not.toHaveBeenCalled(); expect(boundedCurl).toHaveBeenCalledOnce(); }
      else expect(fetcher).toHaveBeenCalledOnce();
      if (failure === 'read') expect(cancel).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally { clock.mockRestore(); vi.useRealTimers(); }
  });
  it('uses only the configured bounded system transport for cash coverage, never the old unbounded helper or fetch', async () => {
    const fetcher = vi.fn<typeof fetch>(), oldCurl = vi.fn();
    const bounded = vi.fn().mockResolvedValue({ status: 200, body: '{"hasNext":false,"nextCursor":"","items":[]}' });
    await new TInvestOrderClient('isolated', sandboxEndpoint, fetcher,
      { transport: 'system-curl', curlPost: oldCurl, boundedCurlPost: bounded })
      .getSandboxCashOperationsWindow('synthetic-account', cashFrom, cashTo);
    expect(bounded).toHaveBeenCalledOnce(); expect(fetcher).not.toHaveBeenCalled(); expect(oldCurl).not.toHaveBeenCalled();
    expect(bounded.mock.calls[0]?.[0]).toMatchObject({ maxBytes: 1_048_576, timeoutMs: expect.any(Number) });
  });
  it.each(['https://example.test/rest', 'https://invest-public-api.tbank.ru/rest', `${sandboxEndpoint}?secret=private`])
    ('rejects a noncanonical cash endpoint before any request: %s', async endpoint => {
      const fetcher = vi.fn<typeof fetch>();
      await expect(new TInvestOrderClient('isolated', endpoint, fetcher)
        .getSandboxCashOperationsWindow('synthetic-account', cashFrom, cashTo)).rejects.toThrow('not available');
      expect(fetcher).not.toHaveBeenCalled();
    });
  const exitInput={mode:'sandbox' as const,accountId:'local-account',instrumentId:'local-instrument',requestId:input.orderRequestId,lots:3,limitNano:'9900000001'};
  const exitAck=()=>({orderId:'local-sell',orderRequestId:exitInput.requestId,instrumentUid:exitInput.instrumentId,direction:'ORDER_DIRECTION_SELL',
    orderType:'ORDER_TYPE_LIMIT',executionReportStatus:'EXECUTION_REPORT_STATUS_FILL',lotsRequested:'3',lotsExecuted:'3'});
  it('posts one exact-nano non-margin FOK sandbox session SELL and requires its request identity',async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(exitAck())));
    expect(await new TInvestOrderClient('isolated','https://example.test/rest',fetcher).postSandboxSessionExit(exitInput)).toBe('local-sell');
    expect(fetcher).toHaveBeenCalledOnce();expect(fetcher.mock.calls[0]?.[0]).toContain('SandboxService/PostSandboxOrder');
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({accountId:'local-account',instrumentId:'local-instrument',quantity:'3',
      price:{units:'9',nano:900000001},direction:'ORDER_DIRECTION_SELL',orderType:'ORDER_TYPE_LIMIT',orderId:exitInput.requestId,
      timeInForce:'TIME_IN_FORCE_FILL_OR_KILL',priceType:'PRICE_TYPE_CURRENCY',confirmMarginTrade:false});
  });
  it.each([{mode:'live'},{lots:0},{lots:1.5},{requestId:'foreign'},{limitNano:'-1'}])('rejects an invalid session SELL before network: %j',async changes=>{
    const fetcher=vi.fn<typeof fetch>();await expect(new TInvestOrderClient('isolated','https://example.test/rest',fetcher)
      .postSandboxSessionExit({...exitInput,...changes} as typeof exitInput)).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([{orderRequestId:undefined},{instrumentUid:'other'},{direction:'ORDER_DIRECTION_BUY'},{lotsExecuted:'4'},{orderId:'bad\nID'}])
    ('rejects a mismatched session SELL acknowledgement without retry: %j',async changes=>{
      const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({...exitAck(),...changes})));
      await expect(new TInvestOrderClient('isolated','https://example.test/rest',fetcher).postSandboxSessionExit(exitInput)).rejects.toMatchObject({outcomeUncertain:true});
      expect(fetcher).toHaveBeenCalledOnce();
    });
  it('cancels only a sandbox stop once; the timestamp acknowledgement is not a sale',async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response('{"time":"2026-10-01T15:30:00Z"}'));
    await new TInvestOrderClient('isolated','https://example.test/rest',fetcher).cancelSandboxStop({mode:'sandbox',accountId:'local-account',stopId:'local-stop'});
    expect(fetcher).toHaveBeenCalledOnce();expect(fetcher.mock.calls[0]?.[0]).toContain('SandboxService/CancelSandboxStopOrder');
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({accountId:'local-account',stopOrderId:'local-stop'});
  });
  it.each(['bad-ack','timeout','http'])('uncertain cancellation %s is never retried',async failure=>{
    const fetcher=vi.fn<typeof fetch>();if(failure==='timeout')fetcher.mockRejectedValue(new Error('private secret'));
    else fetcher.mockResolvedValue(new Response('{}',{status:failure==='http'?500:200}));
    await expect(new TInvestOrderClient('isolated','https://example.test/rest',fetcher).cancelSandboxStop({mode:'sandbox',accountId:'local-account',stopId:'local-stop'}))
      .rejects.toMatchObject({outcomeUncertain:true});expect(fetcher).toHaveBeenCalledOnce();
  });
  const stopInput = { mode: 'sandbox' as const, accountId: 'local-account', instrumentId: 'local-instrument',
    requestId: input.orderRequestId, lots: 3, stopNano: '9900000001', limitNano: '9900000001' };
  it('posts exactly one non-margin sandbox SELL stop-limit with a durable request UUID', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ stopOrderId: 'local-stop', orderRequestId: stopInput.requestId })));
    const client = new TInvestOrderClient('isolated-token', 'https://example.test/rest', fetcher);
    expect(await client.postSandboxStopLimit(stopInput)).toBe('local-stop');
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://example.test/rest/tinkoff.public.invest.api.contract.v1.SandboxService/PostSandboxStopOrder');
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({ accountId: 'local-account', instrumentId: 'local-instrument',
      quantity: '3', stopPrice: { units: '9', nano: 900000001 }, price: { units: '9', nano: 900000001 },
      direction: 'STOP_ORDER_DIRECTION_SELL', stopOrderType: 'STOP_ORDER_TYPE_STOP_LIMIT',
      expirationType: 'STOP_ORDER_EXPIRATION_TYPE_GOOD_TILL_CANCEL', exchangeOrderType: 'EXCHANGE_ORDER_TYPE_LIMIT',
      priceType: 'PRICE_TYPE_CURRENCY', orderId: stopInput.requestId, confirmMarginTrade: false });
  });
  it.each([{ mode: 'live' }, { lots: 0 }, { lots: 1.5 }, { lots: 1000001 }, { requestId: 'not-a-uuid' }])
    ('rejects invalid stop before network: %j', async changes => {
      const fetcher = vi.fn<typeof fetch>(); const client = new TInvestOrderClient('isolated-token', 'https://example.test/rest', fetcher);
      await expect(client.postSandboxStopLimit({ ...stopInput, ...changes } as typeof stopInput)).rejects.toThrow();
      expect(fetcher).not.toHaveBeenCalled();
    });
  it.each([{}, { stopOrderId: 'local-stop', orderRequestId: 'foreign' }, { stopOrderId: 'bad\nID', orderRequestId: input.orderRequestId }])
    ('keeps an incomplete stop response uncertain and never retries: %j', async payload => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(payload)));
      await expect(new TInvestOrderClient('isolated-token', 'https://example.test/rest', fetcher).postSandboxStopLimit(stopInput))
        .rejects.toMatchObject({ outcomeUncertain: true });
      expect(fetcher).toHaveBeenCalledOnce();
    });
  it('reads ALL sandbox stops without writing or switching endpoints', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'));
    await new TInvestOrderClient('isolated-token', 'https://example.test/rest', fetcher).getSandboxStopOrders('local-account');
    expect(fetcher.mock.calls[0]?.[0]).toContain('SandboxService/GetSandboxStopOrders');
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({ accountId: 'local-account', status: 'STOP_ORDER_STATUS_ALL' });
  });
  it('reads the known child by EXCHANGE ID, not the parent request UUID', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'));
    await new TInvestOrderClient('isolated-token', 'https://example.test/rest', fetcher).getSandboxChildOrderState('local-account', 'local-child');
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[0]).toContain('SandboxService/GetSandboxOrderState');
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({ accountId: 'local-account', orderId: 'local-child',
      orderIdType: 'ORDER_ID_TYPE_EXCHANGE', priceType: 'PRICE_TYPE_CURRENCY' });
  });
  it.each([{}, { accounts: [{}] }])('does not interpret an incomplete account response as no accounts: %j', payload => {
    const client = new TInvestOrderClient('local-secret', 'https://example.test/rest',
      vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(payload))));
    return expect(client.getSandboxAccounts()).rejects.toThrow('response is incomplete');
  });
  it('uses the explicitly selected one-shot system transport for sandbox reads', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const curlPost = vi.fn().mockResolvedValue({ status: 200, statusText: 'HTTP 200', body: '{"accounts":[]}' });
    const client = new TInvestOrderClient('isolated-trading-token', 'https://example.test/rest', fetcher, { transport: 'system-curl', curlPost });
    expect(await client.getSandboxAccounts()).toEqual([]);
    expect(curlPost).toHaveBeenCalledOnce(); expect(fetcher).not.toHaveBeenCalled();
    expect(curlPost).toHaveBeenCalledWith({ url: 'https://example.test/rest/tinkoff.public.invest.api.contract.v1.SandboxService/GetSandboxAccounts',
      token: 'isolated-trading-token', body: '{}' });
  });
  it.each(['network', 'http'])('never retries or switches transports on %s submission failure', async failure => {
    const fetcher = vi.fn<typeof fetch>(); const curlPost = vi.fn();
    if (failure === 'network') curlPost.mockRejectedValue(new Error('private-secret'));
    else curlPost.mockResolvedValue({ status: 409, statusText: 'HTTP 409', body: '{}' });
    const client = new TInvestOrderClient('isolated-secret', 'https://example.test/rest', fetcher, { transport: 'system-curl', curlPost });
    await expect(client.postLimitOrder(input)).rejects.toMatchObject({ outcomeUncertain: true });
    expect(curlPost).toHaveBeenCalledOnce(); expect(fetcher).not.toHaveBeenCalled();
  });
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
