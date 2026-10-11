import { numberToQuotation } from '../domain/money.js';
import { postWithSystemCurl, type CurlPost, type TInvestTransport } from '../tbank/client.js';
import { liveProductionEndpoint } from './live-preflight-client.js';
import { nanoQuotation } from './sandbox-stop-state.js';
import { TInvestOrderError } from './tinvest-order-client.js';

type FetchLike = typeof fetch;

export type LiveLimitOrderInput = {
  mode: 'live';
  accountId: string;
  instrumentId: string;
  lots: number;
  limitPrice: number;
  direction: 'buy' | 'sell';
  orderRequestId: string;
};

export type LiveLimitOrderResult = {
  brokerOrderId: string;
  executionStatus: string;
  lotsRequested: number;
  lotsExecuted: number;
};

const requestIdPattern = /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asInteger(value: unknown): number | null {
  const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export class LiveOrderClient {
  constructor(
    private readonly token: string | undefined,
    private readonly baseUrl: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly options: { transport?: TInvestTransport; curlPost?: CurlPost } = {},
  ) {
    const url = new URL(baseUrl);
    if (url.href.replace(/\/$/, '') !== liveProductionEndpoint
      || url.protocol !== 'https:' || url.hostname !== 'invest-public-api.tbank.ru'
      || url.pathname !== '/rest' || url.search || url.hash || url.username || url.password || url.port) {
      throw new Error('Live orders require the verified production HTTPS endpoint');
    }
  }

  async postLimitOrder(input: LiveLimitOrderInput): Promise<LiveLimitOrderResult> {
    if (input.mode !== 'live' || !requestIdPattern.test(input.orderRequestId)
      || !Number.isSafeInteger(input.lots) || input.lots <= 0 || input.lots > 1_000_000
      || !Number.isFinite(input.limitPrice) || input.limitPrice <= 0) {
      throw new TInvestOrderError('Invalid live order', false);
    }
    const payload = await this.request('tinkoff.public.invest.api.contract.v1.OrdersService/PostOrder', {
      instrumentId: input.instrumentId,
      quantity: String(input.lots),
      price: numberToQuotation(input.limitPrice),
      direction: input.direction === 'buy' ? 'ORDER_DIRECTION_BUY' : 'ORDER_DIRECTION_SELL',
      accountId: input.accountId,
      orderType: 'ORDER_TYPE_LIMIT',
      orderId: input.orderRequestId,
      timeInForce: 'TIME_IN_FORCE_FILL_OR_KILL',
      priceType: 'PRICE_TYPE_CURRENCY',
      confirmMarginTrade: false,
    }, true);
    const result = asRecord(payload);
    const brokerOrderId = asString(result?.orderId);
    const executionStatus = asString(result?.executionReportStatus);
    const lotsRequested = asInteger(result?.lotsRequested);
    const lotsExecuted = asInteger(result?.lotsExecuted);
    if (!brokerOrderId || !executionStatus || lotsRequested !== input.lots || lotsExecuted === null || lotsExecuted > lotsRequested) {
      throw new TInvestOrderError('T-Invest returned an invalid order response', true);
    }
    return { brokerOrderId, executionStatus, lotsRequested, lotsExecuted };
  }

  getOrderState(accountId: string, orderRequestId: string): Promise<unknown> {
    if (!requestIdPattern.test(orderRequestId)) throw new TInvestOrderError('Invalid live order lookup', false);
    return this.request('tinkoff.public.invest.api.contract.v1.OrdersService/GetOrderState', {
      accountId, orderId: orderRequestId, orderIdType: 'ORDER_ID_TYPE_REQUEST', priceType: 'PRICE_TYPE_CURRENCY',
    }, false);
  }

  async postStopLimit(input: { mode: 'live'; accountId: string; instrumentId: string;
    requestId: string; lots: number; stopNano: string; limitNano: string }): Promise<string> {
    if (input.mode !== 'live' || !Number.isSafeInteger(input.lots) || input.lots <= 0 || input.lots > 1_000_000
      || !requestIdPattern.test(input.requestId)) {
      throw new TInvestOrderError('Invalid live stop intent', false);
    }
    const result = asRecord(await this.request('tinkoff.public.invest.api.contract.v1.StopOrdersService/PostStopOrder', {
      accountId: input.accountId, instrumentId: input.instrumentId, quantity: String(input.lots),
      stopPrice: nanoQuotation(input.stopNano), price: nanoQuotation(input.limitNano),
      direction: 'STOP_ORDER_DIRECTION_SELL', stopOrderType: 'STOP_ORDER_TYPE_STOP_LIMIT',
      expirationType: 'STOP_ORDER_EXPIRATION_TYPE_GOOD_TILL_CANCEL', exchangeOrderType: 'EXCHANGE_ORDER_TYPE_LIMIT',
      priceType: 'PRICE_TYPE_CURRENCY', orderId: input.requestId, confirmMarginTrade: false,
    }, true));
    const brokerId = asString(result?.stopOrderId);
    const echoed = result?.orderRequestId;
    if (!brokerId || brokerId.length > 256 || /[\u0000-\u001f\u007f]/.test(brokerId)
      || (echoed !== undefined && echoed !== input.requestId)) {
      throw new TInvestOrderError('Live stop response does not confirm the request', true);
    }
    return brokerId;
  }

  private async request(path: string, body: unknown, uncertainOnNetwork: boolean): Promise<unknown> {
    if (!this.token) throw new TInvestOrderError('Live credential is not configured', false);
    let status: number;
    let payload: unknown;
    try {
      const url = `${this.baseUrl}/${path}`;
      const serialized = JSON.stringify(body);
      if (this.options.transport === 'system-curl') {
        const response = await (this.options.curlPost ?? postWithSystemCurl)({ url, token: this.token, body: serialized });
        status = response.status;
        payload = JSON.parse(response.body) as unknown;
      } else {
        const response = await this.fetchImpl(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json',
            'x-app-name': 'AndStrel.trading-live-executor',
          },
          body: serialized,
          signal: AbortSignal.timeout(10_000),
          redirect: 'error',
        });
        status = response.status;
        payload = await response.json().catch(() => ({}));
      }
    } catch {
      throw new TInvestOrderError('T-Invest live request did not return a confirmed response', uncertainOnNetwork);
    }
    if (status < 200 || status >= 300) {
      throw new TInvestOrderError(`T-Invest live API returned HTTP ${status}`, uncertainOnNetwork);
    }
    return payload;
  }
}
