import type { AppConfig } from '../config.js';
import type { ExecutionService } from '../execution/execution-service.js';
import type { LivePilotPreflight } from '../execution/live-pilot-preflight.js';
import {
  type JournalScenarioRecord,
  ScenarioJournal,
} from '../journal/scenario-journal.js';
import type {
  IntradayScanEvent,
  IntradayScanner,
  IntradayScanReport,
} from '../scanner/intraday-scanner.js';
import { moscowCalendarDay } from '../domain/lqdt-cash-sleeve.js';
import { readPaperDualMomentumSignal } from '../domain/sbmx-sbgb-dual-momentum.js';
import { buildCandidateCardSvg, renderCandidateCardPng } from './candidate-card.js';
import type { TelegramClient, TelegramUpdate } from './client.js';
import { menuCommand, tradingMenu } from './menu.js';
import { formatNanoRub } from '../execution/sandbox-round-trip.js';
import { getStrategyDescriptor, isTradingStrategyId, STRATEGY_CATALOG, type TradingStrategyId } from '../strategies/catalog.js';
import type { TradingSelection } from '../strategies/selection.js';

type TradingReport = Omit<IntradayScanReport, 'strategyId' | 'selectionRevision' | 'recommendations'> &
  Partial<Pick<IntradayScanReport, 'strategyId' | 'selectionRevision' | 'recommendations'>>;
type ScannerControl = Pick<IntradayScanner, 'isPaused' | 'pause' | 'resume'> & {
    getLatestReport?(): TradingReport | null;
    getTradingSelection?(): TradingSelection;
    getAvailableTickers?(): string[];
    selectTradingStrategy?(id: TradingStrategyId, expectedRevision: number): void;
    selectTradingAssets?(tickers: string[], expectedRevision: number): void;
  };
type ExecutionControl = Pick<
  ExecutionService,
  | 'mode'
  | 'isConfigured'
  | 'isReady'
  | 'isKilled'
  | 'armSandbox'
  | 'kill'
  | 'queueScenario'
  | 'rejectScenario'
  | 'listRecent'
  | 'submitScenario'
  | 'reconcileScenario'
>;
type TelegramBotLog = (message: string) => void;
type CardRenderer = (svg: string) => Promise<Uint8Array>;

function normalizeCommand(text: string): string {
  const fromMenu = menuCommand(text);
  if (fromMenu) return fromMenu;
  const firstWord = text.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? '';
  return firstWord.replace(/@[a-z0-9_]+$/i, '');
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatTradePrice(value: number): string {
  return new Intl.NumberFormat('en-US', {
    useGrouping: false,
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 9,
  }).format(value);
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
}

function formatTurnover(value: number | null): string {
  if (value === null) return '—';
  if (value >= 1_000_000) return `${formatNumber(value / 1_000_000)} млн ₽`;
  if (value >= 1_000) return `${formatNumber(value / 1_000)} тыс. ₽`;
  return `${formatNumber(value)} ₽`;
}

function snapshotInstrumentLabel(record: JournalScenarioRecord): string | null {
  if (typeof record.snapshot !== 'object' || record.snapshot === null) return null;
  const snapshot = record.snapshot as Record<string, unknown>;
  if (typeof snapshot.instrument !== 'object' || snapshot.instrument === null) return null;
  const instrument = snapshot.instrument as Record<string, unknown>;
  const label = instrument.label ?? instrument.ticker;
  return typeof label === 'string' && label.trim() ? label.trim() : null;
}

function selectionText(selection: TradingSelection | undefined): string {
  return selection ? `Стратегия: ${getStrategyDescriptor(selection.strategyId).name} · ревизия ${selection.revision}\nАктивы: ${selection.tickers.join(', ')}` : '';
}

function formatMarketReport(report: TradingReport, selection?: TradingSelection): string {
  const top = report.topRanked.length
    ? report.topRanked.map((item, index) => {
        const state = item.candidateReady ? 'готов к проверке рынка' : 'наблюдение';
        const trend = item.trend === 'up' ? '↑' : item.trend === 'down' ? '↓' : '→';
        const volume = item.relativeVolume === null ? '—' : `${formatNumber(item.relativeVolume)}x`;
        return `${index + 1}. ${item.ticker} — ${item.score}/100 · ${trend} · объём ${volume} · оборот ${formatTurnover(item.averageCandleTurnoverRub)} · ${state}`;
      })
    : ['нет данных для ранжирования'];
  const missing = report.universe.missingTickers.length
    ? `\nНе найдены/недоступны: ${report.universe.missingTickers.join(', ')}`
    : '';

  return [
    `Рынок · ${formatDate(report.observedAt)}`,
    ...(selection ? [selectionText(selection)] : []),
    `Вселенная: ${report.universe.active}/${report.universe.requested} акций (${report.universe.source})`,
    `Проверено: ${report.scanned} · ликвидны: ${report.liquid} · тренд ↑: ${report.trendUp} · объём ≥1.0: ${report.volumeConfirmed}`,
    `До стакана допущено: ${report.readyForMarketCheck} · кандидатов рынка: ${report.marketCandidates} · сохранено: ${report.recordedCandidates}`,
    report.errors ? `Ошибки запросов: ${report.errors}` : 'Ошибки запросов: нет',
    '',
    'Топ ситуаций:',
    ...top,
  ].join('\n') + missing;
}

function instrumentLabel(record: JournalScenarioRecord, config: AppConfig): string {
  return (
    snapshotInstrumentLabel(record) ??
    config.scanner.intradayWatchlist.find((item) => item.instrumentId === record.instrumentId)?.label ??
    record.instrumentId
  );
}

function formatCandidateFallback(
  record: JournalScenarioRecord,
  config: AppConfig,
  executionHint = '',
): string {
  return [
    `Кандидат #${record.id} · ${instrumentLabel(record, config)}`,
    `Вход: ${formatTradePrice(record.input.entryPrice)} ₽ · стоп: ${formatTradePrice(record.input.stopPrice)} ₽ · цель: ${formatTradePrice(record.input.targetPrice)} ₽`,
    `Время: ${formatDate(record.observedAt)}`,
    `Карточка не сформировалась; брокерская заявка не отправлена.${executionHint}`,
  ].join('\n');
}

function previewScenario(config: AppConfig): JournalScenarioRecord {
  const watchlistItem = config.scanner.intradayWatchlist[0];
  const instrumentId = watchlistItem?.instrumentId ?? 'preview';
  const lotSize = watchlistItem?.lotSize ?? 1;

  return {
    id: 0,
    recordedAt: new Date().toISOString(),
    observedAt: new Date().toISOString(),
    strategy: 'intraday',
    instrumentId,
    input: {
      side: 'long',
      entryPrice: 100,
      stopPrice: 99,
      targetPrice: 102.5,
      lotSize,
      slippageRate: config.scanner.slippageRate,
    },
    decision: 'candidate',
    blockers: [],
    warnings: [],
    snapshot: {
      tradePlan: {
        lots: 5,
        units: 5 * lotSize,
        positionRub: 500,
        totalRiskRub: 7,
        estimatedCommissionRub: 0.5,
        estimatedSlippageRub: 0.5,
        netRewardRub: 11.5,
        rewardToRisk: 1.64,
      },
      market: { bestBid: 99.99, bestAsk: 100, spreadPct: 0.01 },
      candleAnalysis: { trend: 'up', relativeVolume: 1.2, averageTrueRange14: 0.3 },
    },
  };
}

function helpText(): string {
  return [
    'Команды:',
    '/menu — показать меню кнопок',
    '/app — открыть Mini App в личном чате',
    '/status — состояние сканера',
    '/market — последний проход, фильтры и лучшие ситуации',
    '/strategies — выбрать стратегию кнопкой',
    '/strategy ID — выбрать стратегию командой',
    '/assets — текущие активы и панель выбора',
    '/assets VTBR,IRAO — выбрать активы',
    '/recommendations — объяснения по выбранным активам',
    '/candidates — последние кандидаты',
    '/preview — тестовая карточка без запроса рынка',
    '/pause — поставить сканер на паузу',
    '/resume — продолжить проходы',
    '/execution — состояние исполнения',
    '/pilot — одобренные лимиты дневного пилота',
    '/pilot_check — проверить отдельный live-счёт без заявок',
    '/orders — последние подготовленные поручения',
    '/reconcile ID — сверить sandbox-заявку без повторной отправки',
    '/execution_arm SANDBOX — разрешить подтверждённые заявки в песочнице',
    '/approve ID CONFIRM — подтвердить одну sandbox-заявку',
    '/reject ID — отклонить подготовленную заявку',
    '/kill — немедленно запретить новые отправки заявок',
    '/paper — сводка admitted paper-стратегий (кэш + dual momentum)',
    '/sleeve — локальный paper cash sleeve LQDT/SBMM (без заявок брокеру)',
    '/dual — paper dual momentum SBMX/SBGB/SBMM (сигнал, без заявок брокеру)',
    '',
    'Реальный счёт недоступен: реализовано только подтверждаемое исполнение в песочнице.',
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
    private readonly renderCard: CardRenderer = renderCandidateCardPng,
    private readonly execution?: ExecutionControl,
    private readonly pilot?: Pick<LivePilotPreflight, 'check'>,
  ) {}

  async start(): Promise<never> {
    await this.announceMenu();
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

  async announceMenu(): Promise<void> {
    const app = this.config.telegram.miniApp;
    for (const chatId of this.config.telegram.allowedChatIds.filter(id => /^\d+$/.test(id))) {
      const key = `telegram.menu.v2.${app.enabled ? 'miniapp' : 'buttons'}.${chatId}`;
      if (this.journal.getRuntimeState(key) === 'sent') continue;
      try {
        await this.client.sendMessage(chatId, app.enabled
          ? 'Теперь бот управляется кнопками. Mini App доступен через кнопку «Панель» или «📱 Мини-приложение». Реальная торговля остаётся выключенной.'
          : 'Стратегии, активы и рекомендации — в меню ниже. Реальная торговля остаётся выключенной.',
        { replyMarkup: tradingMenu() });
        if (app.enabled && app.url) await this.client.setChatMenuButton?.(chatId, app.url);
        this.journal.setRuntimeState(key, 'sent');
      } catch { this.log('Telegram menu update not confirmed; it will be retried on restart'); }
    }
  }

  async pollOnce(): Promise<void> {
    this.initialize();
    const updates = await this.client.getUpdates({
      offset: this.offset,
      timeoutSeconds: this.config.telegram.pollingTimeoutSeconds,
    });
    // Empty polls used to leave no trace, so a live long-poll looked identical to a dead one.
    this.log(`Telegram poll ok: updates=${updates.length}`);

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

    let executionHint = '';
    let executionScenarioId: number | undefined;
    if (this.execution?.mode() === 'sandbox') {
      try {
        const order = this.execution.queueScenario(scenario);
        if (order) {
          executionHint = `\nПесочница: /approve ${scenario.id} CONFIRM или /reject ${scenario.id}`;
          executionScenarioId = scenario.id;
        }
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : 'Unknown execution queue error';
        this.log(`Execution queue failed for scenario ${scenario.id}: ${detail}`);
      }
    } else if (this.execution) {
      executionHint = '\nИсполнение выключено. Заявка не готовилась. Чтобы она стала подтверждаемой, нужен T_INVEST_EXECUTION_MODE=sandbox, затем /execution_arm SANDBOX и /approve ID CONFIRM. Реальные заявки недоступны.';
    }

    for (const chatId of this.config.telegram.allowedChatIds) {
      await this.sendCandidateCard(
        chatId,
        scenario,
        'Новый кандидат для проверки',
        executionHint,
        executionScenarioId,
      );
    }
  }

  private initialize(): void {
    if (this.initialized) return;
    this.offset = this.journal.getTelegramUpdateOffset();
    this.initialized = true;
  }

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    if (update.callback_query) {
      await this.handleCallbackQuery(update);
      return;
    }

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

    if (command === '/start' || command === '/menu' || command === '/help') {
      await this.client.sendMessage(normalizedChatId, 'Управление — кнопками ниже. Реальные заявки пока заблокированы.\n\n' + helpText(), { replyMarkup: tradingMenu() });
      return;
    }
    if (command === '/app') {
      if (update.message?.chat?.type !== 'private') {
        await this.client.sendMessage(normalizedChatId, 'Mini App открывается только из личного чата с ботом.');
      } else if (!this.config.telegram.miniApp.enabled || !this.config.telegram.miniApp.url) {
        await this.client.sendMessage(normalizedChatId, 'Mini App готовится. Пока используйте кнопки меню.', { replyMarkup: tradingMenu() });
      } else {
        // An INLINE launch supplies signed initData. A keyboard web_app launch
        // does not, so the persistent menu sends this inline launch separately.
        await this.client.sendMessage(normalizedChatId, 'Панель: статус, кандидаты и ограничения. Реальные заявки недоступны.', {
          replyMarkup: { inline_keyboard: [[{ text: 'Открыть Mini App', web_app: { url: this.config.telegram.miniApp.url } }]] },
        });
      }
      return;
    }

    if (command === '/candidates') {
      await this.sendRecentCandidates(normalizedChatId);
      return;
    }
    if (command === '/strategies') {
      await this.sendStrategies(normalizedChatId);
      return;
    }
    if (command === '/strategy') {
      await this.selectStrategyCommand(normalizedChatId, text);
      return;
    }
    if (command === '/assets') {
      await this.assetsCommand(normalizedChatId, menuCommand(text) ?? text, update.message?.chat?.type);
      return;
    }
    if (command === '/recommendations') {
      await this.client.sendMessage(normalizedChatId, this.recommendationsText());
      return;
    }
    if (command === '/market') {
      await this.client.sendMessage(normalizedChatId, this.marketText());
      return;
    }
    if (command === '/preview') {
      await this.sendCandidateCard(
        normalizedChatId,
        previewScenario(this.config),
        'Тестовая карточка — это не данные рынка',
      );
      return;
    }
    if (command === '/approve') {
      await this.approveExecution(normalizedChatId, text);
      return;
    }
    if (command === '/reject') {
      await this.rejectExecution(normalizedChatId, text);
      return;
    }
    if (command === '/reconcile') {
      const parts = text.trim().split(/\s+/);
      const id = Number(parts[1]);
      if (parts.length !== 2 || !Number.isSafeInteger(id) || id <= 0) {
        await this.client.sendMessage(normalizedChatId, 'Формат сверки: /reconcile ID');
      } else if (!this.execution) {
        await this.client.sendMessage(normalizedChatId, 'Модуль исполнения не подключён.');
      } else {
        try {
          const result = await this.execution.reconcileScenario(id);
          const exit = result.sandboxExit;
          const sale = exit ? ` Продано ${exit.soldLots}, осталось ${exit.remainingLots} лот. Результат после известных комиссий: ${exit.netPnlNano === null ? 'не подтверждён' : formatNanoRub(exit.netPnlNano)}. Пустой счёт: ${exit.flatConfirmedAt ? 'подтверждён при этой сверке' : 'не подтверждён'}. Sandbox, не реальная доходность.` : '';
          const reserve = result.order.status === 'failed' ? 'Подтверждено нулевое исполнение; резерв освобождён.' : 'Резерв риска сохранён.';
          await this.client.sendMessage(normalizedChatId, `Sandbox-сверка #${id}: ${result.executionStatus}; исполнено ${result.lotsExecuted}/${result.order.lots} лот.${sale} Новая заявка не отправлялась. ${reserve}`);
        } catch {
          await this.client.sendMessage(normalizedChatId, 'Сверка не подтверждена. Новая заявка не отправлялась; ранее зарезервированный риск сохранён.');
        }
      }
      return;
    }
    if (command === '/orders') {
      await this.client.sendMessage(normalizedChatId, this.ordersText());
      return;
    }
    if (command === '/pilot_check') {
      if (!this.pilot) {
        await this.client.sendMessage(normalizedChatId, 'Проверка пилота не подключена; реальные заявки недоступны.');
        return;
      }
      try {
        const report = await this.pilot.check();
        await this.client.sendMessage(normalizedChatId, [
          this.pilotText(),
          `Проверка счёта: ${report.accountChecksPassed ? 'пройдена' : 'не пройдена'}`,
          report.availableCashRub === null ? 'Свободные деньги: не подтверждены' : `Свободные деньги: ${formatNumber(report.availableCashRub)} ₽`,
          ...report.blockers,
        ].join('\n'));
      } catch {
        await this.client.sendMessage(normalizedChatId, 'Проверка пилота не завершена. Реальная заявка не отправлена.');
      }
      return;
    }
    if (command === '/execution_arm') {
      await this.armExecution(normalizedChatId, text);
      return;
    }
    if (command === '/kill') {
      this.execution?.kill();
      await this.client.sendMessage(
        normalizedChatId,
        this.execution
          ? 'Kill switch включён. Новые заявки не будут отправляться.'
          : 'Модуль исполнения не подключён.',
      );
      return;
    }

    const reply = this.commandReply(command);
    await this.client.sendMessage(normalizedChatId, reply, { replyMarkup: tradingMenu() });
  }

  private async sendCandidateCard(
    chatId: string,
    scenario: JournalScenarioRecord,
    captionPrefix: string,
    executionHint = '',
    executionScenarioId?: number,
  ): Promise<void> {
    const caption = `${captionPrefix}: #${scenario.id} · ${instrumentLabel(scenario, this.config)}. Ручная проверка обязательна; брокерская заявка не отправлена.${executionHint}`;

    try {
      const png = await this.renderCard(buildCandidateCardSvg(scenario, this.config));
      await this.client.sendPhoto({
        chatId,
        png,
        caption,
        ...(executionScenarioId
          ? {
              replyMarkup: {
                inline_keyboard: [
                  [
                    {
                      text: `✅ Подтвердить sandbox #${executionScenarioId}`,
                      callback_data: `exec:approve:${executionScenarioId}:confirm`,
                    },
                  ],
                  [
                    {
                      text: `❌ Отклонить #${executionScenarioId}`,
                      callback_data: `exec:reject:${executionScenarioId}`,
                    },
                  ],
                ],
              },
            }
          : {}),
      });
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : 'Unknown candidate card error';
      this.log(`Candidate card delivery failed: ${detail}`);

      try {
        await this.client.sendMessage(
          chatId,
          formatCandidateFallback(scenario, this.config, executionHint),
        );
      } catch (fallbackError: unknown) {
        const fallbackDetail =
          fallbackError instanceof Error ? fallbackError.message : 'Unknown Telegram send error';
        this.log(`Candidate fallback delivery failed: ${fallbackDetail}`);
      }
    }
  }

  private async sendRecentCandidates(chatId: string): Promise<void> {
    const candidates = this.journal
      .list(30, 'intraday')
      .filter((record) => record.decision === 'candidate')
      .slice(0, 5);

    if (candidates.length === 0) {
      await this.client.sendMessage(chatId, 'В журнале пока нет intraday-кандидатов.');
      return;
    }

    for (const candidate of candidates) {
      await this.sendCandidateCard(chatId, candidate, 'Кандидат из журнала');
    }
  }

  private commandReply(command: string): string {
    switch (command) {
      case '/start':
      case '/help':
        return helpText();
      case '/status':
        return this.statusText();
      case '/paper':
        return this.paperSummaryText();
      case '/sleeve':
        return this.sleeveText();
      case '/dual':
        return this.dualMomentumText();
      case '/execution':
        return this.executionText();
      case '/pilot':
        return this.pilotText();
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

  private paperSummaryText(): string {
    return ['Admitted paper-only (не live):', '', this.sleeveText(), '', '—', '', this.dualMomentumText()].join(
      '\n',
    );
  }

  private sleeveText(): string {
    const sleeve = this.journal.getPaperCashSleeve();
    if (!sleeve) {
      return [
        'Paper cash sleeve: не открыт.',
        'Парковка кэша — LQDT или SBMM без недельного перезахода, не торговый сигнал.',
        'Открытие/маркировка — через MCP open_paper_cash_sleeve / mark_paper_cash_sleeve. Заявок брокеру нет.',
      ].join('\n');
    }
    if (sleeve.state.status === 'empty') {
      return [
        `Paper cash sleeve ${sleeve.ticker}: закрыт.`,
        `Денежный остаток модели: ${formatNumber(sleeve.state.cash)} ₽`,
        sleeve.closeNote ? `Заметка: ${sleeve.closeNote}` : 'Это не live-позиция.',
      ].join('\n');
    }
    return [
      `Paper cash sleeve ${sleeve.ticker}: открыт (${sleeve.role})`,
      `Вход: ${sleeve.state.entryDay} @ ${formatNumber(sleeve.state.entryPrice)}`,
      `Марк: ${sleeve.state.lastMarkDay} @ ${formatNumber(sleeve.state.lastMarkPrice)}`,
      `Оценка выхода с издержками: ${formatNumber(sleeve.state.markedEquity)} ₽`,
      'Не перезаходить каждую неделю. Заявок брокеру нет.',
    ].join('\n');
  }

  private dualMomentumText(): string {
    const signal = readPaperDualMomentumSignal(moscowCalendarDay());
    if (!signal.available) {
      return [
        'Paper dual momentum SBMX/SBGB/SBMM: нет локальных дневных снимков.',
        'Сигнал считается только по файлам .trading/*-daily-*.json. Заявок брокеру нет.',
      ].join('\n');
    }
    const staleNote = signal.stale
      ? `Снимки актуальны до ${signal.dataThrough}; запрошен ${signal.requestedAsOf ?? 'сегодня'}. Обновите daily-импорт.`
      : `Данные через ${signal.dataThrough}.`;
    return [
      `Paper dual momentum: ${signal.sleeve ?? 'еще нет сигнала'} на ${signal.asOf}`,
      staleNote,
      signal.firstSignalDay ? `Первый исторический сигнал: ${signal.firstSignalDay}` : 'Разогрев не завершён.',
      'Правило из SBMX_SBGB_SBMM_DUAL_MOMENTUM_V1. Не live-допуск. Заявок брокеру нет.',
    ].join('\n');
  }

  private statusText(): string {
    const universe =
      this.config.scanner.universeMode === 'moex-liquid'
        ? `MOEX liquid, до ${this.config.scanner.maxInstruments} акций`
        : this.config.scanner.intradayWatchlist.map((item) => item.label ?? item.instrumentId).join(', ') ||
          'не задан';
    const report = this.scanner.getLatestReport?.();

    return [
      `Сканер: ${this.scanner.isPaused() ? 'пауза' : 'активен'}`,
      `Интервал: ${this.config.scanner.intervalSeconds / 60} мин.`,
      `Вселенная: ${universe}`,
      ...(this.scanner.getTradingSelection ? [selectionText(this.scanner.getTradingSelection())] : []),
      report ? `Последний проход: ${formatDate(report.observedAt)}` : 'Последний проход: ещё не завершён',
      `Cooldown кандидатов: ${this.config.scanner.candidateCooldownMinutes} мин.`,
      this.executionText(),
    ].join('\n');
  }

  private marketText(): string {
    const report = this.scanner.getLatestReport?.();
    const selection = this.scanner.getTradingSelection?.();
    if (!report) {
      return [selectionText(selection), 'Первый проход рынка с текущими настройками ещё не завершён. Повторите /market через 1–2 минуты.'].filter(Boolean).join('\n');
    }
    return formatMarketReport(report, selection);
  }

  private recommendationsText(): string {
    const selection = this.scanner.getTradingSelection?.();
    const report = this.scanner.getLatestReport?.();
    if (!report?.recommendations?.length || (selection && report.selectionRevision !== undefined
      && (report.selectionRevision !== selection.revision || report.strategyId !== selection.strategyId))) {
      return [selectionText(selection), 'Рекомендации для текущего выбора ещё не готовы. Дождитесь нового прохода рынка.'].filter(Boolean).join('\n');
    }
    const labels = { signal: 'сигнал для проверки', wait: 'наблюдать', blocked: 'пропустить', error: 'ошибка данных' };
    const money = (value: number | null) => typeof value === 'number' && Number.isFinite(value) ? `${formatNumber(value)} ₽` : '—';
    return [
      `Рекомендации · ${formatDate(report.observedAt)}`, selectionText(selection),
      ...report.recommendations.slice(0, 5).map(item => [
        `${item.ticker}: ${labels[item.status]} · оценка ${item.score}/100`,
        `Лот: ${money(item.lotCostRub)} · затраты круга: ${money(item.roundTripCostsRub)}`,
        `Расчётный риск: ${money(item.totalRiskRub)} · потенциал после расходов: ${money(item.netRewardRub)}`,
        ...item.reasons.slice(0, 2).map(reason => `• ${reason.slice(0, 240)}`),
      ].join('\n')),
      'Оценка отражает соответствие правилам, а не вероятность прибыльной сделки. Карточки кандидатов доступны через /candidates.',
    ].filter(Boolean).join('\n\n');
  }

  private async sendStrategies(chatId: string): Promise<void> {
    const selection = this.scanner.getTradingSelection?.();
    const descriptions = STRATEGY_CATALOG.map(item => `${selection?.strategyId === item.id ? '✓ ' : ''}${item.name}\n${item.description}`);
    await this.client.sendMessage(chatId, [
      'Выберите торговый подход:', ...descriptions,
      'После смены стратегии рекомендации пересчитываются. Прибыльность этих правил пока не подтверждена.',
    ].join('\n\n'), selection && this.scanner.selectTradingStrategy ? {
      replyMarkup: { inline_keyboard: STRATEGY_CATALOG.map(item => [{
        text: `${selection.strategyId === item.id ? '✓ ' : ''}${item.name}`,
        callback_data: `strategy:${item.id}:${selection.revision}`,
      }]) },
    } : { replyMarkup: tradingMenu() });
  }

  private async selectStrategyCommand(chatId: string, text: string): Promise<void> {
    const parts = text.trim().split(/\s+/);
    if (parts.length !== 2 || !isTradingStrategyId(parts[1])) {
      await this.sendStrategies(chatId);
      return;
    }
    const selection = this.scanner.getTradingSelection?.();
    if (!selection || !this.scanner.selectTradingStrategy) {
      await this.client.sendMessage(chatId, 'Выбор стратегии в этом процессе пока не подключён.');
      return;
    }
    await this.applyStrategy(chatId, parts[1], selection.revision);
  }

  private async applyStrategy(chatId: string, id: TradingStrategyId, revision: number): Promise<void> {
    if (!this.scanner.selectTradingStrategy) {
      await this.client.sendMessage(chatId, 'Выбор стратегии в этом процессе пока не подключён.');
      return;
    }
    try {
      this.scanner.selectTradingStrategy(id, revision);
    } catch {
      await this.client.sendMessage(chatId, 'Выбор не применён: настройки уже изменились или недоступны. Откройте /strategies заново.');
      return;
    }
    await this.client.sendMessage(chatId, `Выбрано: ${getStrategyDescriptor(id).name}. Рекомендации появятся после нового прохода рынка.`, { replyMarkup: tradingMenu() });
  }

  private async assetsCommand(chatId: string, text: string, chatType: string | undefined): Promise<void> {
    const parts = text.trim().split(/\s+/);
    const selection = this.scanner.getTradingSelection?.();
    if (parts.length > 1) {
      const tickers = parts[1]?.split(',').map(value => value.trim().toUpperCase()) ?? [];
      if (parts.length !== 2 || !tickers.length || tickers.some(ticker => !/^[A-Z0-9.-]{1,16}$/.test(ticker))
        || tickers.length > 40 || new Set(tickers).size !== tickers.length) {
        await this.client.sendMessage(chatId, 'Формат выбора: /assets VTBR,IRAO — тикеры через запятую без повторов.');
        return;
      }
      if (!selection || !this.scanner.selectTradingAssets) {
        await this.client.sendMessage(chatId, 'Выбор активов в этом процессе пока не подключён.');
        return;
      }
      try { this.scanner.selectTradingAssets(tickers, selection.revision); }
      catch {
        await this.client.sendMessage(chatId, 'Выбор не применён. Список должен содержать доступные активы; при изменении настроек откройте /assets заново.');
        return;
      }
      await this.client.sendMessage(chatId, `Выбраны активы: ${tickers.join(', ')}. Рекомендации пересчитаются после нового прохода.`, { replyMarkup: tradingMenu() });
      return;
    }
    const app = this.config.telegram.miniApp;
    const available = this.scanner.getAvailableTickers?.() ?? [];
    await this.client.sendMessage(chatId, [
      selection ? `Текущие активы: ${selection.tickers.join(', ')}` : 'Выбор активов пока не подключён.',
      available.length ? `Доступны: ${available.join(', ')}` : '',
      'Выберите активы в панели или командой /assets VTBR,IRAO.',
    ].filter(Boolean).join('\n'), app.enabled && app.url && chatType === 'private' ? {
      replyMarkup: { inline_keyboard: [[{ text: 'Выбрать активы в панели', web_app: { url: app.url } }]] },
    } : { replyMarkup: tradingMenu() });
  }

  private pilotText(): string {
    const pilot = this.config.livePilot;
    return [
      `Дневной пилот: ${pilot.prepare ? 'подготовка' : 'выключен'}`,
      `Капитал: ${formatNumber(pilot.capitalRub)} ₽, включая расходы входа.`,
      `Расчётный риск: ${formatNumber(pilot.maxTradeRiskRub)} ₽/сделка; ${formatNumber(pilot.maxDailyRiskRub)} ₽/день.`,
      `Порог фактического дневного убытка: ${formatNumber(pilot.maxDailyLossRub)} ₽ — монитор ещё не подключён.`,
      `Комиссия в модели: ${formatNumber(this.config.commissionRate * 100)}% на сторону плюс проскальзывание.`,
      'Без плеча и шортов; средства недельного счёта не используются.',
      'Реальные заявки недоступны. Лимит риска не гарантирует размер фактического убытка.',
    ].join('\n');
  }

  private executionText(): string {
    if (!this.execution) return 'Исполнение: модуль не подключён';
    return [
      `Исполнение: ${this.execution.mode()}`,
      `Токен: ${this.execution.isConfigured() ? 'задан' : 'не задан'}`,
      `Sandbox-счёт: ${this.execution.isReady() ? 'настроен; активация требует отдельной проверки' : 'требуется отдельная подготовка'}`,
      `Kill switch: ${this.execution.isKilled() ? 'включён' : 'выключен'}`,
      'Live-режим отсутствует; доступна только песочница с подтверждением каждой заявки.',
    ].join('\n');
  }

  private ordersText(): string {
    if (!this.execution) return 'Модуль исполнения не подключён.';
    const orders = this.execution.listRecent(5);
    if (orders.length === 0) return 'Подготовленных поручений пока нет.';
    return [
      'Последние sandbox-поручения:',
      ...orders.map(
        (order) =>
          `#${order.scenarioId}: ${order.status}, ${order.lots} лот. по ${formatTradePrice(order.limitPrice)} ₽, риск ${formatNumber(order.estimatedRiskRub)} ₽`,
      ),
    ].join('\n');
  }

  private async armExecution(chatId: string, text: string): Promise<void> {
    if (!this.execution) {
      await this.client.sendMessage(chatId, 'Модуль исполнения не подключён.');
      return;
    }
    const confirmation = text.trim().split(/\s+/)[1];
    if (confirmation !== 'SANDBOX') {
      await this.client.sendMessage(chatId, 'Для включения отправьте точно: /execution_arm SANDBOX');
      return;
    }
    try {
      await this.execution.armSandbox();
      await this.client.sendMessage(
        chatId,
        'Sandbox-исполнение разрешено. Каждая заявка всё равно требует /approve ID CONFIRM.',
      );
    } catch (error: unknown) {
      await this.client.sendMessage(chatId, `Не включено: ${this.errorMessage(error)}`);
    }
  }

  private async approveExecution(chatId: string, text: string): Promise<void> {
    if (!this.execution) {
      await this.client.sendMessage(chatId, 'Модуль исполнения не подключён.');
      return;
    }
    const [, rawId, confirmation] = text.trim().split(/\s+/);
    const scenarioId = Number(rawId);
    if (!Number.isSafeInteger(scenarioId) || scenarioId <= 0 || confirmation !== 'CONFIRM') {
      await this.client.sendMessage(chatId, 'Формат подтверждения: /approve ID CONFIRM');
      return;
    }
    await this.submitExecution(chatId, scenarioId);
  }

  private async submitExecution(chatId: string, scenarioId: number): Promise<void> {
    if (!this.execution) {
      await this.client.sendMessage(chatId, 'Модуль исполнения не подключён.');
      return;
    }
    try {
      const result = await this.execution.submitScenario(scenarioId, chatId);
      await this.client.sendMessage(
        chatId,
        `Sandbox-заявка #${scenarioId}: ${result.executionStatus}; исполнено ${result.lotsExecuted}/${result.order.lots} лот.`,
      );
    } catch (error: unknown) {
      await this.client.sendMessage(chatId, `Результат заявки #${scenarioId} не подтверждён: ${this.errorMessage(error)}. При сетевом сбое используйте /reconcile ${scenarioId}; заявку нельзя считать отсутствующей.`);
    }
  }

  private async rejectExecution(chatId: string, text: string): Promise<void> {
    if (!this.execution) {
      await this.client.sendMessage(chatId, 'Модуль исполнения не подключён.');
      return;
    }
    const rawId = text.trim().split(/\s+/)[1];
    const scenarioId = Number(rawId);
    if (!Number.isSafeInteger(scenarioId) || scenarioId <= 0) {
      await this.client.sendMessage(chatId, 'Формат отказа: /reject ID');
      return;
    }
    await this.rejectExecutionById(chatId, scenarioId);
  }

  private async rejectExecutionById(chatId: string, scenarioId: number): Promise<void> {
    if (!this.execution) {
      await this.client.sendMessage(chatId, 'Модуль исполнения не подключён.');
      return;
    }
    try {
      this.execution.rejectScenario(scenarioId, chatId);
      await this.client.sendMessage(chatId, `Sandbox-заявка #${scenarioId} отклонена.`);
    } catch (error: unknown) {
      await this.client.sendMessage(chatId, `Не отклонено: ${this.errorMessage(error)}`);
    }
  }

  private async handleCallbackQuery(update: TelegramUpdate): Promise<void> {
    const callback = update.callback_query;
    const callbackId = callback?.id;
    const chatId = callback?.message?.chat?.id;
    const data = callback?.data;
    if (!callbackId || !Number.isSafeInteger(chatId) || typeof data !== 'string') return;

    const normalizedChatId = String(chatId);
    if (!this.config.telegram.allowedChatIds.includes(normalizedChatId)) {
      await this.client.answerCallbackQuery?.(callbackId, 'Нет доступа');
      this.log(`Ignored Telegram callback from an unauthorized chat: ${normalizedChatId}`);
      return;
    }

    if (data.startsWith('strategy:')) {
      const match = /^strategy:([a-z0-9-]{1,48}):([1-9]\d{0,15})$/.exec(data);
      const id = match?.[1];
      const revision = Number(match?.[2]);
      if (data.length > 64 || !isTradingStrategyId(id) || !Number.isSafeInteger(revision) || revision < 1) {
        await this.client.answerCallbackQuery?.(callbackId, 'Некорректный выбор стратегии');
        return;
      }
      await this.client.answerCallbackQuery?.(callbackId, 'Проверяю выбор…');
      await this.applyStrategy(normalizedChatId, id, revision);
      return;
    }

    const approveMatch = /^exec:approve:(\d+):confirm$/.exec(data);
    const rejectMatch = /^exec:reject:(\d+)$/.exec(data);
    const scenarioId = Number(approveMatch?.[1] ?? rejectMatch?.[1]);
    if (!Number.isSafeInteger(scenarioId) || scenarioId <= 0) {
      await this.client.answerCallbackQuery?.(callbackId, 'Некорректная команда');
      return;
    }

    await this.client.answerCallbackQuery?.(
      callbackId,
      approveMatch ? 'Проверяю и отправляю…' : 'Отклоняю…',
    );
    if (approveMatch) await this.submitExecution(normalizedChatId, scenarioId);
    else await this.rejectExecutionById(normalizedChatId, scenarioId);
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'неизвестная ошибка';
  }
}
