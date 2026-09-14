# Локальный intraday-сканер

## Что он делает

Сканер работает на вашем компьютере и раз в пять минут проверяет только инструменты из `T_INVEST_INTRADAY_WATCHLIST`. Он использует 5-минутные свечи за последние шесть часов, стакан, последнюю цену и статус торгов.

Он автоматически сохраняет карточку сценария только при всех условиях:

- 5-минутный тренд `up`;
- относительный объём не ниже 1.0;
- доступны ATR, нормальный стакан и API-торговля;
- расчёт позиции укладывается в лимиты риска;
- нет более свежего `candidate` для той же бумаги в пределах cooldown.

Сканер **не создаёт брокерских заявок и не открывает paper-позиции**. Он только создаёт материал для проверки.

## Первый запуск

После merge и обновления проекта добавьте в локальный `.env`:

```dotenv
T_INVEST_INTRADAY_WATCHLIST='[{"instrumentId":"e6123145-9665-43e0-8413-cd61b8aa9b13","lotSize":1,"priceStep":0.01}]'
T_INVEST_SCANNER_INTERVAL_SECONDS=300
T_INVEST_SCANNER_LOOKBACK_MINUTES=360
T_INVEST_SCANNER_CANDIDATE_COOLDOWN_MINUTES=30
T_INVEST_SCANNER_SLIPPAGE_RATE=0.0005
```

Это пример только для обыкновенных акций Сбера. Сначала оставьте один инструмент.

Затем:

```bash
cd ~/dev/trading
npm run build
chmod 700 scripts/start-intraday-scanner.sh
npm run scan:intraday
```

Первый scan выполняется сразу, последующие — через несколько секунд после границы 5-минутного интервала. Строки JSON в терминале — журнал каждого прохода.

## Постоянный запуск через systemd user service

Скопируйте шаблон и включите сервис:

```bash
mkdir -p ~/.config/systemd/user
cp ~/dev/trading/docs/trading-intraday-scanner.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now trading-intraday-scanner
systemctl --user status trading-intraday-scanner
```

Логи:

```bash
journalctl --user -u trading-intraday-scanner -f
```

Остановить:

```bash
systemctl --user disable --now trading-intraday-scanner
```

Если процесс должен продолжать работать после выхода из графической сессии:

```bash
loginctl enable-linger "$USER"
```

Перед запуском service всегда проверьте ручной запуск `npm run scan:intraday`. Не помещайте токен в unit-файл: launcher читает его только из локального `.env`.
