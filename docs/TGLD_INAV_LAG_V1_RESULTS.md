# TGLD lagging ruble iNAV v1 — rejected after costs

The [rule and gate](TGLD_INAV_LAG_V1.md) were fixed before the joint
outcomes were calculated. Reproduce offline with `npm run build` and
`node dist/research-tgld-inav-lag.js`. The full ignored result
`.trading/tgld-inav-lag-v1.json` has SHA-256
`9f1854aa1639aad41dc2d074bec7844309b27528b55d68ba13726bfb916c72df`.

Of 133 ordinary dates, four lacked the exact TGLD 10:00 anchor, 50 stayed
in cash, eight signals had no TGLD entry print within two minutes, one
entered signal had no printed 16:55–17:00 exit, and **70 trades completed**.
Gross print-proxy winners were 38/70 (54.3%), with +0.1682% mean gross.
After the predeclared favorable zero-brokerage assumption, 0.10% adverse
execution per side and adverse 0.01-RUB rounding, only **24/70 (34.3%)**
were strictly net-positive. Mean base net was **−0.1308%** per completed
trade; stress mean was −0.2827%. Removing the best five completed trades
left a −20.77 percentage-point aggregate. Base-net means were negative
both March–May (−0.1953%, 29 trades) and June–September (−0.0852%, 41).

**Decision:** reject this exact rule. It fails the 100-trade, 51% net-win,
positive-mean, stress, both-block, resilience and zero-unresolved gates.
An additional [paired one-tick sensitivity](TGLD_EXECUTION_TICK_FLOOR.md)
still has only 33/70 net winners even under a tiny positive adverse-fill
allowance with the observed 0.01-RUB price grid.
Do not lower the lag threshold or alter exit time on this already-used
sample and call it independent evidence. The conditional zero fee may not
apply after other account applications; minute trade prices do not prove
quotes or fills; current data-use rights for profit-oriented index signals
are unresolved. No real or sandbox order was placed.
