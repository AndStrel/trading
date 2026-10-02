import type { ExecutionMode } from '../config.js';
import { numberToQuotation } from '../domain/money.js';
import { postWithSystemCurl, type CurlPost, type TInvestTransport } from '../tbank/client.js';
import { nanoQuotation } from './sandbox-stop-state.js';
import { hydrateSandboxSingleUnitOrder, sandboxOrderNeedsOperations } from './sandbox-operation-evidence.js';

type FetchLike = typeof fetch;

export type LimitOrderInput = {
  mode: Exclude<ExecutionMode, 'disabled'>;
  accountId: string;
  instrumentId: string;
  lots: number;
  limitPrice: number;
  direction: 'buy' | 'sell';
  orderRequestId: string;
};

export type LimitOrderResult = {
  brokerOrderId: string;
  executionStatus: string;
  lotsRequested: number;
  lotsExecuted: number;
};

export type SandboxAccount = {
  id: string;
  name: string | null;
};

export class TInvestOrderError extends Error {
  constructor(
    message: string,
    readonly outcomeUncertain: boolean,
    readonly httpStatus?: number,
    readonly brokerCode?: string,
    readonly brokerReasonTags?: string[],
  ) {
    super(message);
    this.name = 'TInvestOrderError';
  }
}

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

export class TInvestOrderClient {
  constructor(
    private readonly token: string | undefined,
    private readonly baseUrl: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly options: { transport?: TInvestTransport; curlPost?: CurlPost } = {},
  ) {}

  async postLimitOrder(input: LimitOrderInput): Promise<LimitOrderResult> {
    if (!this.token) throw new TInvestOrderError('Sandbox credential is not configured', false);
    if (input.mode !== 'sandbox') {
      throw new TInvestOrderError('Only sandbox execution is implemented', false);
    }

    const path = 'tinkoff.public.invest.api.contract.v1.SandboxService/PostSandboxOrder';
    const body = {
      instrumentId: input.instrumentId,
      quantity: input.lots,
      price: numberToQuotation(input.limitPrice),
      direction: input.direction === 'buy' ? 'ORDER_DIRECTION_BUY' : 'ORDER_DIRECTION_SELL',
      accountId: input.accountId,
      orderType: 'ORDER_TYPE_LIMIT',
      orderId: input.orderRequestId,
      timeInForce: 'TIME_IN_FORCE_FILL_OR_KILL',
      priceType: 'PRICE_TYPE_CURRENCY',
      confirmMarginTrade: false,
    };

    const payload = await this.request(path, body, true);
    const result = asRecord(payload);
    const brokerOrderId = asString(result?.orderId);
    const executionStatus = asString(result?.executionReportStatus);
    const lotsRequested = asInteger(result?.lotsRequested);
    const lotsExecuted = asInteger(result?.lotsExecuted);
    if (!brokerOrderId || !executionStatus || lotsRequested !== input.lots || lotsExecuted === null || lotsExecuted > lotsRequested) {
      throw new TInvestOrderError('T-Invest returned an invalid order response', true);
    }

    return {
      brokerOrderId,
      executionStatus,
      lotsRequested,
      lotsExecuted,
    };
  }

  async getSandboxAccounts(): Promise<SandboxAccount[]> {
    const payload = asRecord(
      await this.request(
        'tinkoff.public.invest.api.contract.v1.SandboxService/GetSandboxAccounts',
        {},
        false,
      ),
    );
    const accounts = payload?.accounts;
    if (!Array.isArray(accounts)) throw new TInvestOrderError('Sandbox accounts response is incomplete', false);
    return accounts.map((account) => {
      const record = asRecord(account);
      const id = asString(record?.id);
      if (!id) throw new TInvestOrderError('Sandbox accounts response is incomplete', false);
      return { id, name: asString(record?.name) };
    });
  }

  async getSandboxOrderState(accountId: string, orderRequestId: string): Promise<unknown> {
    const payload=await this.request('tinkoff.public.invest.api.contract.v1.SandboxService/GetSandboxOrderState', {
      accountId, orderId: orderRequestId, orderIdType: 'ORDER_ID_TYPE_REQUEST', priceType: 'PRICE_TYPE_CURRENCY',
    }, false);
    return this.completeSandboxSingleUnitState(accountId,payload,{requestId:orderRequestId});
  }

  async getSandboxChildOrderState(accountId: string, brokerOrderId: string): Promise<unknown> {
    const payload=await this.request('tinkoff.public.invest.api.contract.v1.SandboxService/GetSandboxOrderState', {
      accountId, orderId: brokerOrderId, orderIdType: 'ORDER_ID_TYPE_EXCHANGE', priceType: 'PRICE_TYPE_CURRENCY',
    }, false);
    return this.completeSandboxSingleUnitState(accountId,payload,{brokerOrderId});
  }

  private async completeSandboxSingleUnitState(accountId:string,payload:unknown,lookup:{requestId?:string;brokerOrderId?:string}) {
    if(!sandboxOrderNeedsOperations(payload))return payload;
    const order=payload as {orderDate:string;orderId:string;orderRequestId?:string};
    if((lookup.requestId&&order.orderRequestId!==lookup.requestId)||(lookup.brokerOrderId&&order.orderId!==lookup.brokerOrderId))throw new TInvestOrderError('Sandbox lookup identity is not confirmed',false);
    const now=new Date(),at=Date.parse(order.orderDate);
    if(at>now.getTime()+1000)throw new TInvestOrderError('Sandbox order timestamp is not confirmed',false);
    const operations=await this.request('tinkoff.public.invest.api.contract.v1.SandboxService/GetSandboxOperations',{
      accountId,from:new Date(at-1000).toISOString(),to:new Date(Math.max(at,Math.min(now.getTime(),at+1000))).toISOString(),state:'OPERATION_STATE_EXECUTED'},false);
    return hydrateSandboxSingleUnitOrder(payload,operations,lookup,now);
  }

  getSandboxPositions(accountId: string): Promise<unknown> {
    return this.request('tinkoff.public.invest.api.contract.v1.SandboxService/GetSandboxPositions', { accountId }, false);
  }

  getSandboxOrders(accountId: string): Promise<unknown> {
    return this.request('tinkoff.public.invest.api.contract.v1.SandboxService/GetSandboxOrders', { accountId }, false);
  }

  getSandboxStopOrders(accountId: string): Promise<unknown> {
    return this.request('tinkoff.public.invest.api.contract.v1.SandboxService/GetSandboxStopOrders',
      { accountId, status: 'STOP_ORDER_STATUS_ALL' }, false);
  }

  async postSandboxStopLimit(input: { mode: 'sandbox'; accountId: string; instrumentId: string;
    requestId: string; lots: number; stopNano: string; limitNano: string }): Promise<string> {
    if (input.mode !== 'sandbox' || !Number.isSafeInteger(input.lots) || input.lots <= 0 || input.lots > 1_000_000
      || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(input.requestId)) {
      throw new TInvestOrderError('Invalid sandbox stop intent', false);
    }
    const result = asRecord(await this.request('tinkoff.public.invest.api.contract.v1.SandboxService/PostSandboxStopOrder', {
      accountId: input.accountId, instrumentId: input.instrumentId, quantity: String(input.lots),
      stopPrice: nanoQuotation(input.stopNano), price: nanoQuotation(input.limitNano),
      direction: 'STOP_ORDER_DIRECTION_SELL', stopOrderType: 'STOP_ORDER_TYPE_STOP_LIMIT',
      expirationType: 'STOP_ORDER_EXPIRATION_TYPE_GOOD_TILL_CANCEL', exchangeOrderType: 'EXCHANGE_ORDER_TYPE_LIMIT',
      priceType: 'PRICE_TYPE_CURRENCY', orderId: input.requestId, confirmMarginTrade: false,
    }, true));
    const brokerId = asString(result?.stopOrderId);
    if (!brokerId || brokerId.length > 256 || /[\u0000-\u001f\u007f]/.test(brokerId) || result?.orderRequestId !== input.requestId) {
      throw new TInvestOrderError('Sandbox stop response does not confirm the request', true);
    }
    return brokerId;
  }

  async cancelSandboxStop(input: { mode: 'sandbox'; accountId: string; stopId: string }): Promise<void> {
    if (input.mode !== 'sandbox' || !input.accountId || !input.stopId || input.stopId.length > 256
      || /[\u0000-\u001f\u007f]/.test(input.stopId)) throw new TInvestOrderError('Invalid sandbox stop cancellation', false);
    const result = asRecord(await this.request('tinkoff.public.invest.api.contract.v1.SandboxService/CancelSandboxStopOrder',
      { accountId: input.accountId, stopOrderId: input.stopId }, true));
    if (typeof result?.time !== 'string' || !Number.isFinite(Date.parse(result.time))) {
      throw new TInvestOrderError('Sandbox stop cancellation was not acknowledged', true);
    }
    // HTTP acknowledgement is NOT proof that a racing stop never triggered.
    // The caller must read the exact stop and account state before any SELL.
  }

  async postSandboxSessionExit(input: { mode: 'sandbox'; accountId: string; instrumentId: string;
    requestId: string; lots: number; limitNano: string }): Promise<string> {
    if (input.mode !== 'sandbox' || !input.accountId || !input.instrumentId || !Number.isSafeInteger(input.lots)
      || input.lots <= 0 || input.lots > 1_000_000 || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(input.requestId)) {
      throw new TInvestOrderError('Invalid sandbox session exit', false);
    }
    const result = asRecord(await this.request('tinkoff.public.invest.api.contract.v1.SandboxService/PostSandboxOrder', {
      accountId: input.accountId, instrumentId: input.instrumentId, quantity: String(input.lots), price: nanoQuotation(input.limitNano),
      direction: 'ORDER_DIRECTION_SELL', orderType: 'ORDER_TYPE_LIMIT', orderId: input.requestId,
      timeInForce: 'TIME_IN_FORCE_FILL_OR_KILL', priceType: 'PRICE_TYPE_CURRENCY', confirmMarginTrade: false,
    }, true));
    const id = asString(result?.orderId);
    if (!id || id.length > 256 || /[\u0000-\u001f\u007f]/.test(id) || result?.orderRequestId !== input.requestId
      || result?.instrumentUid !== input.instrumentId || result?.direction !== 'ORDER_DIRECTION_SELL' || result?.orderType !== 'ORDER_TYPE_LIMIT'
      || asInteger(result?.lotsRequested) !== input.lots || asInteger(result?.lotsExecuted) === null || asInteger(result?.lotsExecuted)! > input.lots) {
      throw new TInvestOrderError('Sandbox session exit identity was not acknowledged', true);
    }
    return id;
  }

  async openSandboxAccount(name: string): Promise<string> {
    const payload = asRecord(
      await this.request(
        'tinkoff.public.invest.api.contract.v1.SandboxService/OpenSandboxAccount',
        { name },
        true,
      ),
    );
    const accountId = asString(payload?.accountId);
    if (!accountId) throw new TInvestOrderError('T-Invest returned an invalid sandbox account', true);
    return accountId;
  }

  async sandboxPayIn(accountId: string, rubles: number): Promise<void> {
    await this.request(
      'tinkoff.public.invest.api.contract.v1.SandboxService/SandboxPayIn',
      {
        accountId,
        amount: { ...numberToQuotation(rubles), currency: 'rub' },
      },
      true,
    );
  }

  private async request(path: string, body: unknown, uncertainOnNetwork: boolean): Promise<unknown> {
    if (!this.token) throw new TInvestOrderError('Sandbox credential is not configured', false);

    let status: number;
    let payload: unknown;
    try {
      const url = `${this.baseUrl}/${path}`;
      const serialized = JSON.stringify(body);
      if (this.options.transport === 'system-curl') {
        // Only the low-level one-shot transport is shared. The read-only broker
        // client never receives this token; no retry/fallback is allowed here.
        const response = await (this.options.curlPost ?? postWithSystemCurl)({ url, token: this.token, body: serialized });
        status = response.status;
        payload = JSON.parse(response.body) as unknown;
      } else {
        const response = await this.fetchImpl(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json',
            'x-app-name': 'AndStrel.trading-executor',
          },
          body: serialized,
          signal: AbortSignal.timeout(10_000),
          redirect: 'error',
        });
        status = response.status;
        payload = await response.json().catch(() => ({}));
      }
    } catch (error: unknown) {
      throw new TInvestOrderError('T-Invest sandbox request did not return a confirmed response', uncertainOnNetwork);
    }

    if (status < 200 || status >= 300) {
      const rawCode=asRecord(payload)?.code;
      const rawMessage=asRecord(payload)?.message;
      const brokerReasonTags=typeof rawMessage==='string'?['price','stop','quantity','margin','balance','funds','insufficient','parameter','instrument','limit','activation','greater','less','lower','higher','equal','invalid','unavailable','current','last','expire','exchange','order_id'].filter(tag=>rawMessage.toLowerCase().includes(tag)):[];
      // Extract numeric API code only, never retain arbitrary server text,
      // account IDs, request IDs, token echoes or personal broker payloads.
      const detailCode=typeof rawMessage==='string'?rawMessage.match(/^\s*([348]\d{4})(?:\s|:|$)/)?.[1]:undefined;
      const brokerCode=detailCode??((typeof rawCode==='string'||typeof rawCode==='number')&&/^\d{1,8}$/.test(String(rawCode))?String(rawCode):undefined);
      throw new TInvestOrderError(`T-Invest sandbox API returned HTTP ${status}`,
        // HTTP errors (including duplicate-key conflicts) alone do not prove
        // there is no order. Only verified broker state may release the reserve.
        uncertainOnNetwork,status,brokerCode,brokerReasonTags);
    }
    return payload;
  }
}
