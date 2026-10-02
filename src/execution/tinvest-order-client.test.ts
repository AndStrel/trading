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
  it.each([
    [{code:3,message:'30099: private broker details'},'30099'],
    [{code:3,message:'secret account number 34879'},'3'],
    [{code:'private-token',message:'private-token'},undefined],
  ])('retains only numeric broker error diagnostics without payload or retry',async(payload,code)=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(payload),{status:400}));
    const client=new TInvestOrderClient('synthetic-secret','https://example.test/rest',fetcher);
    await expect(client.postLimitOrder(input)).rejects.toMatchObject({httpStatus:400,brokerCode:code,outcomeUncertain:true,message:'T-Invest sandbox API returned HTTP 400'});
    expect(fetcher).toHaveBeenCalledOnce();
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
