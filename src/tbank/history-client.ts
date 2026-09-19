import { spawn } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FetchLike, TInvestTransport } from './client.js';

export type HistoryArchiveRequest = {
  /** UID is retained as a fallback for explicit legacy callers. */
  instrumentId?: string;
  /** Prefer FIGI for the annual archive endpoint. */
  figi?: string;
  year: number;
};

type CurlArchiveResponse = {
  status: number;
  statusText: string;
  body: Uint8Array;
};

type CurlGetArchiveInput = {
  url: string;
  token: string;
};

export type CurlGetArchive = (input: CurlGetArchiveInput) => Promise<CurlArchiveResponse>;

export type TInvestHistoryClientOptions = {
  transport?: TInvestTransport;
  fetchImpl?: FetchLike;
  curlGetArchive?: CurlGetArchive;
};

const curlStatusPrefix = '__ANDSTREL_TINVEST_HISTORY_STATUS__:';
const maxArchiveBytes = 64 * 1024 * 1024;

function describeNetworkError(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown network failure';

  const cause = error.cause;
  if (!(cause instanceof Error)) return error.message;

  const code = (cause as Error & { code?: unknown }).code;
  const prefix = typeof code === 'string' ? `${code}: ` : '';
  return `${prefix}${cause.message}`;
}

function describeApiError(body: Uint8Array): string {
  const raw = new TextDecoder().decode(body.slice(0, 4_096)).trim();
  if (!raw) return 'empty response body';

  try {
    const parsed = JSON.parse(raw) as { code?: unknown; message?: unknown; description?: unknown };
    const code = typeof parsed.code === 'string' || typeof parsed.code === 'number' ? String(parsed.code) : '';
    const message =
      typeof parsed.message === 'string'
        ? parsed.message
        : typeof parsed.description === 'string'
          ? parsed.description
          : '';
    const detail = [code, message].filter(Boolean).join(': ');
    if (detail) return detail.slice(0, 500);
  } catch {
    // The archive endpoint normally responds with ZIP, while error bodies may be plain text.
  }

  return raw.replaceAll(/\s+/g, ' ').slice(0, 500);
}

async function runCurl(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('curl', args, { stdio: ['ignore', 'pipe', 'pipe'] });
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
  });
}

function parseCurlStatus(stdout: string): number {
  const markerIndex = stdout.lastIndexOf(curlStatusPrefix);
  if (markerIndex === -1) throw new Error('system curl did not return an HTTP status');

  const status = Number.parseInt(stdout.slice(markerIndex + curlStatusPrefix.length).trim(), 10);
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    throw new Error('system curl returned an invalid HTTP status');
  }
  return status;
}

export async function getArchiveWithSystemCurl(input: CurlGetArchiveInput): Promise<CurlArchiveResponse> {
  const directory = await mkdtemp(join(tmpdir(), 'andstrel-trading-history-'));
  const headersFile = join(directory, 'headers');
  const outputFile = join(directory, 'history.zip');

  try {
    await chmod(directory, 0o700);
    await writeFile(
      headersFile,
      [
        `Authorization: Bearer ${input.token}`,
        'Accept: application/zip, application/octet-stream',
        'x-app-name: AndStrel.trading-mcp',
      ].join('\n'),
      { encoding: 'utf8', mode: 0o600 },
    );
    await writeFile(outputFile, new Uint8Array(), { mode: 0o600 });

    const { stdout } = await runCurl([
      '--disable',
      '--silent',
      '--show-error',
      '--location',
      '--request',
      'GET',
      '--header',
      `@${headersFile}`,
      '--connect-timeout',
      '10',
      '--max-time',
      '120',
      '--max-filesize',
      String(maxArchiveBytes),
      '--proto',
      '=https',
      '--output',
      outputFile,
      '--write-out',
      `${curlStatusPrefix}%{http_code}`,
      input.url,
    ]);

    const status = parseCurlStatus(stdout);
    const body = new Uint8Array(await readFile(outputFile));
    if (body.byteLength > maxArchiveBytes) {
      throw new Error(`T-Invest history archive exceeds ${maxArchiveBytes} byte safety limit`);
    }

    return {
      status,
      statusText: `HTTP ${status}`,
      body,
    };
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 1 });
  }
}

function isSuccessStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

function validateRequest(request: HistoryArchiveRequest): void {
  const instrumentId = request.instrumentId?.trim() ?? '';
  const figi = request.figi?.trim() ?? '';
  if ((instrumentId.length > 0 ? 1 : 0) + (figi.length > 0 ? 1 : 0) !== 1) {
    throw new Error('History archive requires exactly one of figi or instrumentId');
  }
  const currentYear = new Date().getUTCFullYear();
  if (!Number.isInteger(request.year) || request.year < 2000 || request.year > currentYear) {
    throw new Error(`History archive year must be an integer from 2000 through ${currentYear}`);
  }
}

export class TInvestHistoryClient {
  private readonly transport: TInvestTransport;
  private readonly fetchImpl: FetchLike;
  private readonly curlGetArchive: CurlGetArchive;

  constructor(
    private readonly token: string | undefined,
    private readonly historyDataUrl: string,
    options: TInvestHistoryClientOptions = {},
  ) {
    this.transport = options.transport ?? 'fetch';
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.curlGetArchive = options.curlGetArchive ?? getArchiveWithSystemCurl;
  }

  async getMinuteCandleArchive(request: HistoryArchiveRequest): Promise<Uint8Array> {
    if (!this.token) {
      throw new Error('T_INVEST_TOKEN is not configured. Use a read-only token.');
    }
    validateRequest(request);

    const url = new URL(this.historyDataUrl);
    if (url.protocol !== 'https:') throw new Error('History archive URL must use HTTPS');
    if (request.figi?.trim()) url.searchParams.set('figi', request.figi.trim());
    else url.searchParams.set('instrument_id', request.instrumentId!.trim());
    url.searchParams.set('year', String(request.year));

    let status: number;
    let statusText: string;
    let body: Uint8Array;

    try {
      if (this.transport === 'system-curl') {
        const response = await this.curlGetArchive({ url: url.toString(), token: this.token });
        status = response.status;
        statusText = response.statusText;
        body = response.body;
      } else {
        const response = await this.fetchImpl(url.toString(), {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.token}`,
            Accept: 'application/zip, application/octet-stream',
            'x-app-name': 'AndStrel.trading-mcp',
          },
          signal: AbortSignal.timeout(120_000),
        });
        status = response.status;
        statusText = response.statusText;
        const contentLength = Number(response.headers.get('content-length'));
        if (Number.isFinite(contentLength) && contentLength > maxArchiveBytes) {
          throw new Error(`T-Invest history archive exceeds ${maxArchiveBytes} byte safety limit`);
        }
        body = new Uint8Array(await response.arrayBuffer());
        if (body.byteLength > maxArchiveBytes) {
          throw new Error(`T-Invest history archive exceeds ${maxArchiveBytes} byte safety limit`);
        }
      }
    } catch (error) {
      throw new Error(`T-Invest history network error: ${describeNetworkError(error)}`);
    }

    if (!isSuccessStatus(status)) {
      throw new Error(`T-Invest history API ${status || statusText}: ${describeApiError(body)}`);
    }
    if (body.byteLength === 0) throw new Error('T-Invest history API returned an empty archive');

    return body;
  }
}
