import { loadConfig } from './config.js';
import { ExecutionService } from './execution/execution-service.js';
import { TInvestOrderClient } from './execution/tinvest-order-client.js';
import { ScenarioJournal } from './journal/scenario-journal.js';
import { IntradayScanner } from './scanner/intraday-scanner.js';
import { TelegramBotClient } from './telegram/client.js';
import { TelegramTradingBot } from './telegram/bot.js';
import { TInvestClient } from './tbank/client.js';

const config = loadConfig();
if (!config.telegram.token) {
  throw new Error('TELEGRAM_BOT_TOKEN is not configured');
}

const journal = new ScenarioJournal(config.journalPath);
const tInvestClient = new TInvestClient(config.token, config.baseUrl, { transport: config.transport });
const execution = new ExecutionService(
  config,
  tInvestClient,
  new TInvestOrderClient(config.execution.token, config.baseUrl),
  journal,
);
const scanner = new IntradayScanner(config, tInvestClient, journal);
const telegram = new TelegramTradingBot(
  config,
  new TelegramBotClient(config.telegram.token),
  scanner,
  journal,
  undefined,
  undefined,
  execution,
);

scanner.addEventListener((event) => telegram.notifyScannerEvent(event));
scanner.start();
await telegram.start();
