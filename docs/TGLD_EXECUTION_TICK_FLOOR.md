# TGLD: one adverse tick defeats two existing lag rules

This is a **post-result paired cost sensitivity**, not a new strategy or a
retuned backtest. Reproduce with `npm run build` and
`node dist/research-tgld-tick-floor.js`. Ignored report
`.trading/tgld-tick-floor.json` SHA-256:
`9abe4a76c7bd8a446b7722398643bd1993fd61ab9f5bffae10a8e562f9761ca0`.
The script verifies the source report hashes and reuses the **same completed
trades and entry/exit print prices** from the predeclared TGLD gold-spot and
TGLD ruble-iNAV lag rules; only modeled adverse execution changes.

The [current MOEX TGLD TQBR metadata](https://iss.moex.com/iss/engines/stock/markets/shares/boards/TQBR/securities/TGLD.json?iss.meta=off&iss.only=securities&securities.columns=SECID,BOARDID,MINSTEP,LOTSIZE,PREVPRICE)
reports `MINSTEP=0.01 RUB`. Every one of the 143,196 OHLC price values
checked across the 133 archived 2026 TGLD dates lies on the 0.01-RUB grid.
These values are not independent price observations. A tiny strictly
positive adverse allowance (`0.000001` per side) therefore rounds a model
buy one kopeck up and a model sell one kopeck down. This is a sensitivity
scenario, **not** proof that every live order necessarily loses a tick on
each side; passive orders may have different fill and adverse-selection
behavior.

- Gold-spot lag: gross/zero-adverse print proxy 36/69 winners (52.2%) and
  +0.1035% mean; one adverse tick per side yields **29/69 (42.0%)** and
  −0.0452% mean. The original base model yields 22/69 and −0.1937% mean.
- Ruble-iNAV lag: gross/zero-adverse print proxy 38/70 winners (54.3%) and
  +0.1682% mean; one adverse tick per side yields **33/70 (47.1%)** and
  +0.0186% mean. The original base model yields 24/70 and −0.1308% mean.

Both fixed rules therefore miss the 51% net-win gate with even this
minimal modeled adverse execution, before historical bid/ask, depth,
latency, taxes, data rights and real fills are established. Changing the
signal threshold or exit time after this result would be sample-fitting.
This conclusion is limited to these two rule sets; it does not rule out all
TGLD strategies. No orders were placed.
