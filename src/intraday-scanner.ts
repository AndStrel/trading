import { loadConfig } from './config.js';
import { ScenarioJournal } from './journal/scenario-journal.js';
import { IntradayScanner } from './scanner/intraday-scanner.js';
import { TInvestClient } from './tbank/client.js';

const config = loadConfig();
const client = new TInvestClient(config.token, config.baseUrl, { transport: config.transport });
const scanner = new IntradayScanner(config, client, new ScenarioJournal(config.journalPath));

scanner.start();
