import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function options(args) {
  const result = { envFile: join(projectDirectory, '.env'), profile: 'telegram', json: false };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--json') result.json = true;
    else if (arg === '--env-file' && args[index + 1]) result.envFile = resolve(args[++index]);
    else if (arg === '--profile' && args[index + 1]) result.profile = args[++index];
    else throw new Error('arguments');
  }
  if (!['telegram', 'mcp', 'sandbox'].includes(result.profile)) throw new Error('arguments');
  return result;
}

function secureEndpoint(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch { return false; }
}

async function diagnose(settings) {
  const checks = [];
  const add = (code, status, message) => checks.push({ code, status, message });
  add('NODE_VERSION', Number(process.versions.node.split('.')[0]) >= 22 ? 'ok' : 'error', 'Требуется Node.js 22 или новее.');
  let parsed;
  let file;
  try {
    file = await open(settings.envFile, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await file.stat();
    if (!info.isFile()) throw new Error('unsafe-file');
    add('ENV_PERMISSIONS', (info.mode & 0o077) === 0 ? 'ok' : 'error', 'Файл .env должен быть приватным: npm run setup установит права 600 без изменения значений.');
    parsed = parseEnv(await file.readFile('utf8'));
    add('ENV_FILE', 'ok', 'Локальный .env прочитан; значения скрыты.');
  } catch {
    add('ENV_FILE', 'error', 'Не удалось прочитать обычный файл .env. Выполните npm run setup; symlink не поддерживается.');
    return checks;
  } finally { await file?.close(); }

  let config;
  const effectiveEnv = { ...parsed, ...process.env };
  const legacyTls = /(?:^|[\s"'])--tls-min-v1\.[01](?=$|[\s"'])/.test(effectiveEnv.NODE_OPTIONS ?? '');
  add('TLS_VERIFICATION', effectiveEnv.NODE_TLS_REJECT_UNAUTHORIZED === '0' || legacyTls ? 'error' : 'ok',
    'Проверка сертификатов и TLS 1.2+ должны оставаться включёнными. Удалите отключение проверки TLS и настройки устаревших протоколов.');
  try {
    const { strategyConfigPreflight } = await import('../src/strategy-config-preflight.ts');
    if (!strategyConfigPreflight(effectiveEnv).configReady) throw new Error('configuration');
    const { loadConfig } = await import('../src/config.ts');
    config = loadConfig(effectiveEnv);
    add('CONFIGURATION', 'ok', 'Конфигурация прошла ту же проверку, что используется сервисом.');
  } catch {
    // Zod errors and arbitrary environment strings can contain secrets. Never render them.
    add('CONFIGURATION', 'error', 'Конфигурация не прошла проверку. Сверьте .env с .env.example, раздельность токенов и настройки Mini App. Запускайте doctor через npm run doctor после npm ci.');
    return checks;
  }
  add('READ_ONLY_TOKEN', config.token ? 'ok' : 'error', 'Нужен T_INVEST_TOKEN с правами только чтения. Наличие значения не подтверждает его права или срок действия.');
  add('BROKER_HTTPS', secureEndpoint(config.baseUrl) ? 'ok' : 'error', 'Адрес брокерских данных должен использовать HTTPS без логина и пароля в URL.');

  if (settings.profile !== 'mcp') {
    add('TELEGRAM_TOKEN', config.telegram.token ? 'ok' : 'error', 'Для Telegram-сервиса нужен TELEGRAM_BOT_TOKEN.');
    add('TELEGRAM_ACCESS', config.telegram.allowedChatIds.length > 0 ? 'ok' : 'warning', 'Для управления задайте TELEGRAM_ALLOWED_CHAT_IDS. При первом запуске пустой список разрешает только получение своего ID через /start.');
    if (config.telegram.miniApp.enabled) {
      add('MINI_APP', 'ok', 'Mini App настроен; сертификат HTTPS и запуск из Telegram проверяются отдельно.');
      add('MINI_APP_CONTAINER_BIND', config.telegram.miniApp.host === '0.0.0.0' ? 'ok' : 'warning', 'Для Docker Mini App должен слушать 0.0.0.0:8080 внутри контейнера; хост публикует только 127.0.0.1:8088.');
    }
  }

  if (settings.profile === 'sandbox' || config.execution.mode === 'sandbox') {
    add('SANDBOX_MODE', config.execution.mode === 'sandbox' ? 'ok' : 'error', 'Для sandbox-профиля требуется T_INVEST_EXECUTION_MODE=sandbox.');
    add('SANDBOX_TOKEN', config.execution.token ? 'ok' : 'error', 'Песочнице нужен отдельный T_INVEST_SANDBOX_TOKEN.');
    add('SANDBOX_PROTECTION', config.execution.sandboxProtectionEnabled ? 'ok' : 'warning', 'Защитный выход включается T_INVEST_SANDBOX_PROTECTION_ENABLED=true.');
    add('SANDBOX_LOSS_GUARD', config.execution.sandboxLossGuardEnabled && config.execution.sandboxProtectionEnabled ? 'ok' : 'warning', 'Контроль дневного убытка требует включённых protection и T_INVEST_SANDBOX_LOSS_GUARD_ENABLED=true.');
    add('SANDBOX_SESSION_CLOSE', config.execution.sandboxSessionCloseEnabled && config.execution.sandboxProtectionEnabled ? 'ok' : 'warning', 'Закрытие в конце сессии требует включённых protection и T_INVEST_SANDBOX_SESSION_CLOSE_ENABLED=true.');
    add('SANDBOX_PREPARATION', 'warning', 'Приватная подготовка счёта, kill switch и состояние заявок этим локальным тестом не проверяются. После запуска используйте /execution.');
  } else add('EXECUTION_DISABLED', 'ok', 'Исполнение заявок отключено в конфигурации.');

  const relayUrl = Boolean(effectiveEnv.T_INVEST_LOCAL_RELAY_URL?.trim());
  const relaySecret = Boolean(effectiveEnv.T_INVEST_LOCAL_RELAY_SECRET?.trim() || effectiveEnv.T_INVEST_LOCAL_RELAY_SECRET_PATH?.trim());
  if (relayUrl || relaySecret) {
    add('MARKET_RELAY_PAIR', relayUrl === relaySecret ? 'ok' : 'error', 'Для relay одновременно нужны его адрес и отдельный секрет либо путь секрета.');
    if (effectiveEnv.T_INVEST_LOCAL_RELAY_SECRET_PATH) {
      add('MARKET_RELAY_SECRET_PATH', effectiveEnv.T_INVEST_LOCAL_RELAY_SECRET_PATH === '/run/relay/secret' ? 'ok' : 'error', 'Контейнер принимает путь relay-секрета только /run/relay/secret.');
    }
  }
  add('CHECK_SCOPE', 'ok', 'Проверка локальная: сеть, Docker, токены у брокера, счета и заявки не затрагивались.');
  return checks;
}

try {
  const settings = options(process.argv.slice(2));
  const checks = await diagnose(settings);
  const ready = !checks.some(check => check.status === 'error');
  const report = { profile: settings.profile, configurationReady: ready, networkChecked: false, brokerWrites: false, checks };
  if (settings.json) process.stdout.write(`${JSON.stringify(report)}\n`);
  else {
    for (const check of checks) process.stdout.write(`[${check.status}] ${check.code}: ${check.message}\n`);
    process.stdout.write(ready ? 'Локальная конфигурация готова. Связь и торговая готовность требуют отдельных проверок.\n' : 'Исправьте ошибки конфигурации и повторите npm run doctor.\n');
  }
  process.exitCode = ready ? 0 : 1;
} catch {
  process.stderr.write('Используйте npm run doctor -- [--profile telegram|mcp|sandbox] [--env-file путь] [--json]. Значения конфигурации не выводились.\n');
  process.exitCode = 1;
}
