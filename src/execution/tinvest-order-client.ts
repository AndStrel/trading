import type { ExecutionMode } from '../config.js';
import { numberToQuotation } from '../domain/money.js';
import { postWithSystemCurl, type CurlPost, type TInvestTransport } from '../tbank/client.js';

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
    if (!this.token) throw new TInvestOrderError('T_INVEST_TRADING_TOKEN is not configured', false);
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
    return this.request('tinkoff.public.invest.api.contract.v1.SandboxService/GetSandboxOrderState', {
      accountId, orderId: orderRequestId, orderIdType: 'ORDER_ID_TYPE_REQUEST', priceType: 'PRICE_TYPE_CURRENCY',
    }, false);
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
    if (!this.token) throw new TInvestOrderError('T_INVEST_TRADING_TOKEN is not configured', false);

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
      throw new TInvestOrderError(`T-Invest sandbox API returned HTTP ${status}`,
        // HTTP errors (including duplicate-key conflicts) alone do not prove
        // there is no order. Only verified broker state may release the reserve.
        uncertainOnNetwork);
    }
    return payload;
  }
}
