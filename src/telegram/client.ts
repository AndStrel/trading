export type TelegramUpdate = {
  update_id: number;
  message?: {
    chat?: { id?: number };
    text?: string;
  };
};

export type TelegramClient = {
  getUpdates(input: { offset: number; timeoutSeconds: number }): Promise<TelegramUpdate[]>;
  sendMessage(chatId: string, text: string): Promise<void>;
};

type TelegramApiResponse<T> = {
  ok?: unknown;
  description?: unknown;
  result?: unknown;
};

type FetchLike = typeof fetch;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export class TelegramBotClient implements TelegramClient {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async getUpdates(input: {
    offset: number;
    timeoutSeconds: number;
  }): Promise<TelegramUpdate[]> {
    const result = await this.request<unknown>('getUpdates', {
      offset: input.offset,
      timeout: input.timeoutSeconds,
      allowed_updates: ['message'],
    }, (input.timeoutSeconds + 10) * 1_000);

    if (!Array.isArray(result)) {
      throw new Error('Telegram API returned an invalid update list');
    }

    return result as TelegramUpdate[];
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    if (text.length > 4_096) {
      throw new Error('Telegram message exceeds the 4096 character limit');
    }

    await this.request('sendMessage', { chat_id: chatId, text }, 15_000);
  }

  private async request<T>(method: string, body: unknown, timeoutMs: number): Promise<T> {
    let response: Response;

    try {
      response = await this.fetchImpl(`https://api.telegram.org/bot${this.token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : 'Unknown network failure';
      throw new Error(`Telegram network error: ${detail}`);
    }

    const payload = (await response.json().catch(() => ({}))) as TelegramApiResponse<T>;
    if (!response.ok || payload.ok !== true) {
      const description = typeof payload.description === 'string' ? payload.description : response.statusText;
      throw new Error(`Telegram API ${response.status}: ${description}`);
    }

    return payload.result as T;
  }
}
