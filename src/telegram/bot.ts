import type { AppConfig } from '../config.js';
import {
  type JournalScenarioRecord,
  ScenarioJournal,
} from '../journal/scenario-journal.js';
import type { IntradayScanEvent, IntradayScanner } from '../scanner/intraday-scanner.js';
import type { TelegramClient, TelegramUpdate } from './client.js';

type ScannerControl = Pick<IntradayScanner, 'isPaused' | 'pause' | 'resume'>;
type TelegramBotLog = (message: string) => void;
type UnknownRecord = Record<string, unknown>;

function normalizeCommand(text: string): string {
  const firstWord = text.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? '';
  return firstWord.replace(/@[a-z0-9_]+$/i, '');
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatRubles(value: number | null): string {
  return value === null ? '—' : `${formatNumber(value)} ₽`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
}

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null ? (value as UnknownRecord) : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function formatCandidateCard(record: JournalScenarioRecord, config: AppConfig): string {
  const instrument =
    config.scanner.intradayWatchlist.find((item) => item.instrumentId === record.instrumentId)?.label ??
    record.instrumentId;
  const snapshot = asRecord(record.snapshot);
  const tradePlan = asRecord(snapshot?.tradePlan);
  const market = asRecord(snapshot?.market);
  const candleAnalysis = asRecord(snapshot?.candleAnalysis);
  const proposal = asRecord(snapshot?.proposal);

  const lots = asFiniteNumber(tradePlan?.lots);
  const units = asFiniteNumber(tradePlan?.units);
  const positionRub = asFiniteNumber(tradePlan?.positionRub);
  const grossRiskRub = asFiniteNumber(tradePlan?.grossRiskRub);
  const commissionRub = asFiniteNumber(tradePlan?.estimatedCommissionRub);
  const slippageRub = asFiniteNumber(tradePlan?.estimatedSlippageRub);
  const totalRiskRub = asFiniteNumber(tradePlan?.totalRiskRub);
  const netRewardRub = asFiniteNumber(tradePlan?.netRewardRub);
  const rewardToRisk = asFiniteNumber(tradePlan?.rewardToRisk);
  const lastPrice = asFiniteNumber(market?.lastPrice);
  const bestBid = asFiniteNumber(market?.bestBid);
  const bestAsk = asFiniteNumber(market?.bestAsk);
  const spreadPct = asFiniteNumber(market?.spreadPct);
  const relativeVolume = asFiniteNumber(candleAnalysis?.relativeVolume);
  const atr = asFiniteNumber(candleAnalysis?.averageTrueRange14);
  const trend = typeof candleAnalysis?.trend === 'string' ? candleAnalysis.trend : null;
  const reasons = asStringArray(proposal?.reasons);

  const direction = record.input.side === 'long' ? 'Покупка' : 'Продажа';
  const lines = [
    `#${record.id} · ${instrument} · ${direction}`,
    `Время сигнала: ${formatDate(record.observedAt)}`,
    '',
    'План:',
    `Вход: ${formatRubles(record.input.entryPrice)}`,
    `Стоп: ${formatRubles(record.input.stopPrice)} · цель: ${formatRubles(record.input.targetPrice)}`,
  ];

  if (lots !== null && units !== null && positionRub !== null) {
    lines.push(
      '',
      `Объём: ${formatNumber(lots)} лот. (${formatNumber(units)} шт.) · ${formatRubles(positionRub)}`,
    );
  }
  if (grossRiskRub !== null && totalRiskRub !== null) {
    lines.push(`Риск до стопа: ${formatRubles(grossRiskRub)} · с затратами: ${formatRubles(totalRiskRub)}`);
  }
  if (commissionRub !== null && slippageRub !== null) {
    lines.push(`Затраты кругом: комиссия ${formatRubles(commissionRub)} + проскальзывание ${formatRubles(slippageRub)}`);
  }
  if (netRewardRub !== null && rewardToRisk !== null) {
    lines.push(`Потенциал чистыми: ${formatRubles(netRewardRub)} · R/R: ${formatNumber(rewardToRisk)}`);
  }
  if (lastPrice !== null || bestBid !== null || bestAsk !== null) {
    lines.push(
      '',
      `Рынок: последняя ${formatRubles(lastPrice)} · bid/ask ${formatRubles(bestBid)} / ${formatRubles(bestAsk)}${spreadPct === null ? '' : ` · спред ${formatNumber(spreadPct)}%`}`,
    );
  }
  if (trend !== null || relativeVolume !== null || atr !== null) {
    lines.push(
      `Сигнал: тренд 5м ${trend ?? '—'} · относ. объём ${relativeVolume === null ? '—' : formatNumber(relativeVolume)} · ATR ${formatRubles(atr)}`,
    );
  }
  if (reasons.length > 0) {
    lines.push('', 'Почему кандидат:', ...reasons.map((reason) => `• ${reason}`));
  }

  lines.push('', 'Требуется ручная проверка. Бот не создавал заявку.');
  return lines.join('\n');
}

function helpText(): string {
  return [
    'Команды:',
    '/status — состояние сканера',
    '/candidates — последние кандидаты',
    '/pause — поставить сканер на паузу',
    '/resume — продолжить проходы',
    '',
    'Бот не открывает paper-сделки и не выставляет брокерские заявки.',
  ].join('\n');
}

export class TelegramTradingBot {
  private initialized = false;
  private offset = 0;

  constructor(
    private readonly config: AppConfig,
    private readonly client: TelegramClient,
    private readonly scanner: ScannerControl,
    private readonly journal: ScenarioJournal,
    private readonly log: TelegramBotLog = (message) => process.stdout.write(`${message}\n`),
  ) {}

  async start(): Promise<never> {
    for (;;) {
      try {
        await this.pollOnce();
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : 'Unknown Telegram polling error';
        this.log(`Telegram polling failed: ${detail}`);
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
    }
  }

  async pollOnce(): Promise<void> {
    this.initialize();
    const updates = await this.client.getUpdates({
      offset: this.offset,
      timeoutSeconds: this.config.telegram.pollingTimeoutSeconds,
    });

    for (const update of updates) {
      await this.handleUpdate(update);

      if (Number.isSafeInteger(update.update_id) && update.update_id >= 0) {
        this.offset = update.update_id + 1;
        this.journal.setTelegramUpdateOffset(this.offset);
      }
    }
  }

  async notifyScannerEvent(event: IntradayScanEvent): Promise<void> {
    if (event.status !== 'candidate-recorded' || !event.scenarioId) return;

    const scenario = this.journal.getScenario(event.scenarioId);
    if (!scenario) {
      this.log(`Candidate notification skipped: scenario ${event.scenarioId} was not found`);
      return;
    }

    const text = ['Новый кандидат для проверки', formatCandidateCard(scenario, this.config)].join('\n\n');
    for (const chatId of this.config.telegram.allowedChatIds) {
      try {
        await this.client.sendMessage(chatId, text);
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : 'Unknown Telegram send error';
        this.log(`Candidate notification to an authorized chat failed: ${detail}`);
      }
    }
  }

  private initialize(): void {
    if (this.initialized) return;
    this.offset = this.journal.getTelegramUpdateOffset();
    this.initialized = true;
  }

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    const chatId = update.message?.chat?.id;
    const text = update.message?.text;
    if (!Number.isSafeInteger(chatId) || typeof text !== 'string') return;

    const normalizedChatId = String(chatId);
    const command = normalizeCommand(text);
    if (!this.config.telegram.allowedChatIds.includes(normalizedChatId)) {
      if (command === '/start') {
        await this.client.sendMessage(
          normalizedChatId,
          `Этот чат ещё не авторизован. Добавьте его ID в TELEGRAM_ALLOWED_CHAT_IDS: ${normalizedChatId}`,
        );
      }
      this.log(`Ignored Telegram command from an unauthorized chat: ${normalizedChatId}`);
      return;
    }

    const reply = this.commandReply(command);
    await this.client.sendMessage(normalizedChatId, reply);
  }

  private commandReply(command: string): string {
    switch (command) {
      case '/start':
      case '/help':
        return helpText();
      case '/status':
        return this.statusText();
      case '/candidates':
        return this.candidatesText();
      case '/pause':
        this.scanner.pause();
        return 'Сканер поставлен на паузу. Новые проходы не будут запрашивать данные рынка.';
      case '/resume':
        this.scanner.resume();
        return 'Сканер снова активен. Следующий проход состоится на ближайшей границе интервала.';
      default:
        return `Неизвестная команда.\n\n${helpText()}`;
    }
  }

  private statusText(): string {
    const watchlist = this.config.scanner.intradayWatchlist
      .map((item) => item.label ?? item.instrumentId)
      .join(', ');

    return [
      `Сканер: ${this.scanner.isPaused() ? 'пауза' : 'активен'}`,
      `Интервал: ${this.config.scanner.intervalSeconds / 60} мин.`,
      `Watchlist: ${watchlist || 'не задан'}`,
      `Cooldown кандидатов: ${this.config.scanner.candidateCooldownMinutes} мин.`,
      'Брокерские и paper-заявки бот не создаёт.',
    ].join('\n');
  }

  private candidatesText(): string {
    const candidates = this.journal
      .list(30, 'intraday')
      .filter((record) => record.decision === 'candidate')
      .slice(0, 5);

    if (candidates.length === 0) {
      return 'В журнале пока нет intraday-кандидатов.';
    }

    return ['Последние кандидаты:', ...candidates.map((record) => formatCandidateCard(record, this.config))].join(
      '\n\n',
    );
  }
}
