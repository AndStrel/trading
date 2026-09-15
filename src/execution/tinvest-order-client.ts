import type { ExecutionMode } from '../config.js';
import { numberToQuotation } from '../domain/money.js';

type FetchLike = typeof fetch;

type ApiErrorBody = {
  message?: string;
  description?: string;
};

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

function asInteger(value: unknown): number {
  const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

export class TInvestOrderClient {
  constructor(
    private readonly token: string | undefined,
    private readonly baseUrl: string,
    private readonly fetchImpl: FetchLike = fetch,
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
    if (!brokerOrderId || !executionStatus) {
      throw new TInvestOrderError('T-Invest returned an invalid order response', true);
    }

    return {
      brokerOrderId,
      executionStatus,
      lotsRequested: asInteger(result?.lotsRequested),
      lotsExecuted: asInteger(result?.lotsExecuted),
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
    if (!Array.isArray(accounts)) return [];
    return accounts.flatMap((account) => {
      const record = asRecord(account);
      const id = asString(record?.id);
      if (!id) return [];
      return [{ id, name: asString(record?.name) }];
    });
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

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
          'x-app-name': 'AndStrel.trading-executor',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : 'unknown network failure';
      throw new TInvestOrderError(`T-Invest order network error: ${detail}`, uncertainOnNetwork);
    }

    const payload = (await response.json().catch(() => ({}))) as unknown;
    if (!response.ok) {
      const errorBody = asRecord(payload) as ApiErrorBody | null;
      const detail = errorBody?.message ?? errorBody?.description ?? response.statusText;
      throw new TInvestOrderError(`T-Invest order API ${response.status}: ${detail}`, false);
    }
    return payload;
  }
}
