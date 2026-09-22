import { spawn } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type FetchLike = typeof fetch;
export type TInvestTransport = 'fetch' | 'system-curl';

type ApiErrorBody = {
  code?: string | number;
  message?: string;
  description?: string;
};

type CurlResponse = {
  status: number;
  statusText: string;
  body: string;
};

type CurlPostInput = {
  url: string;
  token: string;
  body: string;
};

export type CurlPost = (input: CurlPostInput) => Promise<CurlResponse>;

export type TInvestClientOptions = {
  transport?: TInvestTransport;
  fetchImpl?: FetchLike;
  curlPost?: CurlPost;
  requestTimeoutMs?: number;
  retryAttempts?: number;
  retryDelayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
};

const curlStatusPrefix = '\n__ANDSTREL_TINVEST_STATUS__:';
const defaultRequestTimeoutMs = 30_000;
const defaultRetryAttempts = 3;
const defaultRetryDelayMs = 1_000;

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function describeNetworkError(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown network failure';

  const cause = error.cause;
  if (!(cause instanceof Error)) return error.message;

  const code = (cause as Error & { code?: unknown }).code;
  const prefix = typeof code === 'string' ? `${code}: ` : '';
  return `${prefix}${cause.message}`;
}

function asApiErrorBody(payload: unknown): ApiErrorBody {
  if (typeof payload !== 'object' || payload === null) return {};
  return payload as ApiErrorBody;
}

function parsePayload(raw: string): unknown {
  return JSON.parse(raw) as unknown;
}

async function runCurl(args: string[], input: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('curl', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.once('error', reject);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.stdin.once('error', reject);
    child.once('close', (exitCode) => {
      if (exitCode === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const detail = stderr.trim().slice(0, 500);
      reject(
        new Error(
          detail
            ? `system curl exited with code ${exitCode}: ${detail}`
            : `system curl exited with code ${exitCode}`,
        ),
      );
    });
    child.stdin.end(input);
  });
}

function parseCurlResponse(stdout: string): CurlResponse {
  const markerIndex = stdout.lastIndexOf(curlStatusPrefix);
  if (markerIndex === -1) {
    throw new Error('system curl did not return an HTTP status');
  }

  const status = Number.parseInt(stdout.slice(markerIndex + curlStatusPrefix.length).trim(), 10);
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    throw new Error('system curl returned an invalid HTTP status');
  }

  return {
    status,
    statusText: `HTTP ${status}`,
    body: stdout.slice(0, markerIndex),
  };
}

export async function postWithSystemCurl(input: CurlPostInput): Promise<CurlResponse> {
  const directory = await mkdtemp(join(tmpdir(), 'andstrel-trading-'));
  const headersFile = join(directory, 'headers');

  try {
    await chmod(directory, 0o700);
    await writeFile(
      headersFile,
      [
        `Authorization: Bearer ${input.token}`,
        'Content-Type: application/json',
        'Accept: application/json',
        'x-app-name: AndStrel.trading-mcp',
      ].join('\n'),
      { encoding: 'utf8', mode: 0o600 },
    );

    const { stdout } = await runCurl(
      [
        '--disable',
        '--silent',
        '--show-error',
        '--ipv4',
        '--request',
        'POST',
        '--header',
        `@${headersFile}`,
        '--connect-timeout',
        '10',
        '--max-time',
        '30',
        '--proto',
        '=https',
        '--data-binary',
        '@-',
        '--write-out',
        `${curlStatusPrefix}%{http_code}`,
        input.url,
      ],
      input.body,
    );

    return parseCurlResponse(stdout);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 1 });
  }
}

export class TInvestClient {
  private readonly transport: TInvestTransport;
  private readonly fetchImpl: FetchLike;
  private readonly curlPost: CurlPost;
  private readonly requestTimeoutMs: number;
  private readonly retryAttempts: number;
  private readonly retryDelayMs: number;
  private readonly sleep: (delayMs: number) => Promise<void>;

  public constructor(
    private readonly token: string | undefined,
    private readonly baseUrl: string,
    options: TInvestClientOptions = {},
  ) {
    this.transport = options.transport ?? 'fetch';
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.curlPost = options.curlPost ?? postWithSystemCurl;
    this.requestTimeoutMs = Math.max(1, options.requestTimeoutMs ?? defaultRequestTimeoutMs);
    this.retryAttempts = Math.max(1, Math.floor(options.retryAttempts ?? defaultRetryAttempts));
    this.retryDelayMs = Math.max(0, options.retryDelayMs ?? defaultRetryDelayMs);
    this.sleep = options.sleep ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  }

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

  public async findInstrument(query: string): Promise<unknown> {
    return this.post('tinkoff.public.invest.api.contract.v1.InstrumentsService/FindInstrument', {
      query,
      apiTradeAvailableFlag: true,
    });
  }

  public async getShares(): Promise<unknown> {
    return this.post('tinkoff.public.invest.api.contract.v1.InstrumentsService/Shares', {
      instrumentStatus: 'INSTRUMENT_STATUS_BASE',
    });
  }

  public async getLastPrices(instrumentIds: string[]): Promise<unknown> {
    return this.post('tinkoff.public.invest.api.contract.v1.MarketDataService/GetLastPrices', {
      instrumentId: instrumentIds,
      lastPriceType: 'LAST_PRICE_EXCHANGE',
      instrumentStatus: 'INSTRUMENT_STATUS_BASE',
    });
  }

  public async getOrderBook(instrumentId: string, depth: number): Promise<unknown> {
    return this.post('tinkoff.public.invest.api.contract.v1.MarketDataService/GetOrderBook', {
      instrumentId,
      depth,
    });
  }

  public async getTradingStatus(instrumentId: string): Promise<unknown> {
    return this.post('tinkoff.public.invest.api.contract.v1.MarketDataService/GetTradingStatus', {
      instrumentId,
    });
  }

  public async getCandles(params: {
    instrumentId: string;
    from: string;
    to: string;
    interval: string;
  }): Promise<unknown> {
    return this.post('tinkoff.public.invest.api.contract.v1.MarketDataService/GetCandles', params);
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    if (!this.token) {
      throw new Error('T_INVEST_TOKEN is not configured. Use a read-only token.');
    }

    const url = `${this.baseUrl}/${path}`;
    const serializedBody = JSON.stringify(body);

    for (let attempt = 1; attempt <= this.retryAttempts; attempt += 1) {
      let status: number;
      let statusText: string;
      let payload: unknown;

      try {
        if (this.transport === 'system-curl') {
          const response = await this.curlPost({
            url,
            token: this.token,
            body: serializedBody,
          });
          status = response.status;
          statusText = response.statusText;
          payload = parsePayload(response.body);
        } else {
          const response = await this.fetchImpl(url, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${this.token}`,
              'Content-Type': 'application/json',
              'x-app-name': 'AndStrel.trading-mcp',
            },
            body: serializedBody,
            signal: AbortSignal.timeout(this.requestTimeoutMs),
          });

          status = response.status;
          statusText = response.statusText;
          payload = await response.json().catch(() => ({}));
        }
      } catch (error: unknown) {
        if (attempt < this.retryAttempts) {
          await this.sleep(this.retryDelayMs * 2 ** (attempt - 1));
          continue;
        }
        throw new Error(`T-Invest network error: ${describeNetworkError(error)}`);
      }

      if (status < 200 || status >= 300) {
        if (isRetryableStatus(status) && attempt < this.retryAttempts) {
          await this.sleep(this.retryDelayMs * 2 ** (attempt - 1));
          continue;
        }
        const errorBody = asApiErrorBody(payload);
        const detail = errorBody.message ?? errorBody.description ?? statusText;
        throw new Error(`T-Invest API ${status}: ${detail}`);
      }

      return payload;
    }

    throw new Error('T-Invest request exhausted retry attempts');
  }
}
