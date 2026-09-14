export type FetchLike = typeof fetch;

type ApiErrorBody = {
  code?: string | number;
  message?: string;
  description?: string;
};

function describeNetworkError(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown network failure';

  const cause = error.cause;
  if (!(cause instanceof Error)) return error.message;

  const code = (cause as Error & { code?: unknown }).code;
  const prefix = typeof code === 'string' ? `${code}: ` : '';
  return `${prefix}${cause.message}`;
}

export class TInvestClient {
  public constructor(
    private readonly token: string | undefined,
    private readonly baseUrl: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  public async getAccounts(): Promise<unknown> {
    return this.post('tinkoff.public.invest.api.contract.v1.UsersService/GetAccounts', {});
  }

  public async getPortfolio(accountId: string): Promise<unknown> {
    return this.post('tinkoff.public.invest.api.contract.v1.OperationsService/GetPortfolio', {
      accountId,
      currency: 'RUB',
    });
  }

  public async getPositions(accountId: string): Promise<unknown> {
    return this.post('tinkoff.public.invest.api.contract.v1.OperationsService/GetPositions', {
      accountId,
    });
  }

  public async getLastPrices(instrumentIds: string[]): Promise<unknown> {
    return this.post('tinkoff.public.invest.api.contract.v1.MarketDataService/GetLastPrices', {
      instrumentId: instrumentIds,
      lastPriceType: 'LAST_PRICE_EXCHANGE',
      instrumentStatus: 'INSTRUMENT_STATUS_BASE',
    });
  }

  public async getCandles(params: {
    instrumentId: string;
    from: string;
    to: string;
    interval: string;
    limit: number;
  }): Promise<unknown> {
    return this.post('tinkoff.public.invest.api.contract.v1.MarketDataService/GetCandles', params);
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    if (!this.token) {
      throw new Error('T_INVEST_TOKEN is not configured. Use a read-only token.');
    }

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
          'x-app-name': 'AndStrel.trading-mcp',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error: unknown) {
      throw new Error(`T-Invest network error: ${describeNetworkError(error)}`);
    }

    const payload = (await response.json().catch(() => ({}))) as ApiErrorBody;
    if (!response.ok) {
      const detail = payload.message ?? payload.description ?? response.statusText;
      throw new Error(`T-Invest API ${response.status}: ${detail}`);
    }
    return payload;
  }
}
