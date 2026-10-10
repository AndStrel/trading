# Telegram Mini App

Production origin: `https://bot.brewnote.net`. Open using the private-chat
**Панель** menu button or **📱 Мини-приложение** → inline **Открыть Mini App**.
Plain reply-keyboard `web_app` launches provide empty initData, so they are not used.
`/menu` and `/app` remain fallback commands.
The Telegram **Стратегии**, **Активы** and **Рекомендации** buttons also navigate
the new trading controls; **Активы** offers an inline launch of the panel.
See [QUICKSTART](QUICKSTART.md) for initial setup and [STRATEGIES](STRATEGIES.md)
for strategy rules.

## Design system

The four existing sections use the authored **«Чернила и медь»** design system:
dark ink/copper by default, a full light theme, Georgia display headings and a
system fallback for Inter. The theme button works without authentication and
persists only the non-sensitive `trading-kit:theme` choice. No fonts are fetched.
Navigation starts each selected section at the top without smooth scrolling.
The source dialog shows API availability separately from IP country; pending
requests cannot be cancelled merely by closing the dialog. Errors and unknown
outcomes are visible inside the modal, with explicit recovery instructions.
No new broker actions or permissions are added.

Plan, source mapping, browser acceptance and reproduction:
[MINI_APP_DESIGN_INTEGRATION](MINI_APP_DESIGN_INTEGRATION.md).

## Access and limitations

- Public HTML contains no account data. API requires Telegram HMAC initData,
  expires after 300 seconds, and permits only positive IDs already in
  `TELEGRAM_ALLOWED_CHAT_IDS`. Group membership does not grant access.
- Actions require same origin and JSON. Exposed controls are scanner pause/resume,
  persistent entry kill, available market-source selection, strategy selection and
  asset selection. No order submission, arming or approval API exists.
- The authenticated overview shows the chosen strategy, selection revision,
  available/selected tickers and recommendations. Each recommendation explains
  `signal`, `wait`, `blocked` or `error` and exposes costs/risk only when calculated.
  Its score measures rule fit, not the probability of profit. Invalid or stale
  reports show an awaiting-refresh state rather than their earlier recommendations.
- Kill does not close positions. Capital displayed is an approved limit, not
  observed account cash. Actual profit/loss is unavailable, not assumed zero.
- Real submission remains disabled. Displaying a candidate is not admission
  of a profitable strategy or authorization to trade.
- The overview can show separate sandbox sale results: actual virtual sold and
  remaining lots, reported-commission result and last reconciliation time. Missing
  fees/partial sales remain unconfirmed; flat-account evidence is timestamped,
  not a current-balance guarantee. No account/order/trade IDs are exposed. These
  virtual, pre-tax pair results are not live PnL or proof of a strategy edge;
  reservation and kill remain intact even after full sandbox reconciliation.
- Expired panels must be reopened in Telegram. No credentials in query strings,
  local storage, cookies, responses or logs. Do not share initData or bot tokens.

## Authenticated selection API

`GET /api/view` returns the permitted overview. `POST /api/action` handles all
controls after Telegram HMAC verification, allowlist validation, same-origin
validation, JSON content-type and body-size checks. Its maximum request body is
1,024 bytes. Selection fields are strict; unknown keys are rejected.

| Action | Required selection fields |
|---|---|
| `strategy-select` | `strategyId` from the catalog and positive safe-integer `expectedRevision` |
| `assets-select` | Unique uppercase `tickers`, selected from `availableTickers`, and `expectedRevision` |

The panel sends the revision it last read. The API checks that revision and the
controller changes journal state using compare-and-set. A concurrent change or
stale panel receives HTTP `409` and must reload before trying again; malformed
fields or unavailable tickers receive `400`. A successful change advances the
revision, invalidates earlier recommendations and awaits a new scan. Changing
selection does not create broker orders, modify credentials, arm execution or
close positions. Pending scanner candidates from the previous revision are not
accepted for new entries; reconciliation and protective exits retain their scope.

## Deployment

The service's only published port is `127.0.0.1:8088:8080`. Set these public
fields in the server-only `.env`, preserving all other values:

```
TELEGRAM_MINI_APP_ENABLED=true
TELEGRAM_MINI_APP_URL=https://bot.brewnote.net
TELEGRAM_MINI_APP_HOST=0.0.0.0
TELEGRAM_MINI_APP_PORT=8080
```

Run `npm run doctor` on the host, then `npm run deploy` to build and recreate the
service while preserving journal and existing `.env` values. For the already-built
service the underlying restart is `docker compose up -d telegram-service`.
On first successful startup per UI version, private allowlisted chats receive
buttons and the chat menu URL is set; durable journal state prevents repeated
notifications on every restart.

Nginx templates under `infra/nginx` belong only to this hostname. First install
the HTTP template for ACME webroot, then issue a certificate using official
Certbot's pinned image from `ops/renew-mini-app-certificate.sh`. Use independent
root-owned directories `/opt/andstrel/trading-tls/{letsencrypt,work,logs}` and
webroot `/var/www/trading-acme`. Reuse a local copy of the existing ACME account
without modifying `/etc/letsencrypt`; never add private keys to the repository.
Then install the HTTPS template and validate before gracefully reloading nginx.
Install the two dedicated systemd units and enable only their timer. Test renewal
with `bash ops/renew-mini-app-certificate.sh --dry-run`. Do not change system
Certbot packages, existing timers, BrewNote vhosts or the global trust store.

Before editing, back up the bot `.env` root-only, record checksums of existing
enabled vhosts and ensure this new hostname and port do not collide. Keep the
backup path on the server; do not print secrets.

## Acceptance / rollback

Run `npm run check`, `npm run build`, hardened-container renderer smoke, and
mobile UI tests with fictional local-only signed identity. Include authorization,
strict selection payloads, stale revision `409`, failed changes preserving prior
state and exclusion of broker-order actions. In production verify
valid HTTPS, static assets, unauthenticated/forged API 401, loopback-only port,
LIVE false, unchanged BrewNote config checksums and its web/API health. The owner
must verify the real Telegram launch; local signatures do not prove that step.

Rollback: restore the server-only `.env` backup and restart the previous bot
image; disable the dedicated renewal timer. Move only this new vhost/symlink to
the retained root-only backup directory, validate nginx and reload. Keep the
isolated certificate and journal for recovery; do not remove other services.
