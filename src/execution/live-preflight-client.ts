import { numberToQuotation } from '../domain/money.js';
import { postWithSystemCurl, type TInvestTransport } from '../tbank/client.js';

// An intentionally read-only preparation surface using a SEPARATE live token.
// No generic public request, PostOrder, cancel, stop creation or account funding.
export class LivePreflightClient {
  constructor(
    private readonly token: string | undefined,
    private readonly baseUrl: string,
    private readonly transport: TInvestTransport = 'fetch',
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    const url = new URL(baseUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'invest-public-api.tbank.ru'
      || url.pathname !== '/rest' || url.search || url.hash || url.username || url.password || url.port) {
      throw new Error('Live preflight requires the verified production HTTPS endpoint');
    }
  }

  getAccounts(): Promise<unknown> { return this.read('UsersService/GetAccounts', {}); }
  getUserInfo(): Promise<unknown> { return this.read('UsersService/GetInfo', {}); }
  getPositions(accountId: string): Promise<unknown> { return this.read('OperationsService/GetPositions', { accountId }); }
  getOrders(accountId: string): Promise<unknown> { return this.read('OrdersService/GetOrders', { accountId }); }
  getStopOrders(accountId: string): Promise<unknown> { return this.read('StopOrdersService/GetStopOrders', { accountId, status: 'STOP_ORDER_STATUS_ACTIVE' }); }
  getShare(instrumentId: string): Promise<unknown> {
    return this.read('InstrumentsService/ShareBy', { idType: 'INSTRUMENT_ID_TYPE_UID', id: instrumentId });
  }
  getOrderPrice(accountId: string, instrumentId: string, price: number, lots: number, direction: 'buy' | 'sell'): Promise<unknown> {
    if (!Number.isSafeInteger(lots) || lots <= 0 || !Number.isFinite(price) || price <= 0) {
      throw new Error('Invalid quote quantity or price');
    }
    return this.read('OrdersService/GetOrderPrice', {
      accountId, instrumentId, price: numberToQuotation(price), quantity: String(lots),
      direction: direction === 'buy' ? 'ORDER_DIRECTION_BUY' : 'ORDER_DIRECTION_SELL',
    });
  }

  private async read(method: string, body: unknown): Promise<unknown> {
    if (!this.token) throw new Error('Separate live token is not configured');
    const url = `${this.baseUrl}/tinkoff.public.invest.api.contract.v1.${method}`;
    const serialized = JSON.stringify(body);
    // Do not echo broker responses/errors: they can contain account identifiers.
    try {
      if (this.transport === 'system-curl') {
        const response = await postWithSystemCurl({ url, token: this.token, body: serialized });
        if (response.status !== 200) throw new Error('Broker read failed');
        return JSON.parse(response.body) as unknown;
      }
      const response = await this.fetchImpl(url, {
        method: 'POST', redirect: 'error',
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
        body: serialized, signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error('Broker read failed');
      return await response.json() as unknown;
    } catch {
      throw new Error(`Live preflight ${method.split('/')[1]} failed; no order was sent`);
    }
  }
}
