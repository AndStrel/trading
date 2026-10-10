# TMON 2026 minute-print coverage — no price outcomes opened

The [coverage protocol](TMON_2026_SOURCE_PROTOCOL.md) fixed the 2026-01-01 through 2026-09-25 weekday interval, 10:00–17:00 windows, and MOEX's 2026-06-22 TQTF→TQBR board migration before reading 2026 prices. Public MOEX ISS minute trade-candle responses are cached in ignored `.trading/tmon-2026-source/`, with each raw body hash-checked on read. The ignored source manifest `.trading/tmon-2026-source.json` has SHA-256 `1af6cf14621282f93be857d1ab06df9e269b64f53bb842691d93e82a81ddd521`.

Only candle timestamps and row counts were inspected. Among 192 ordinary weekdays, 186 have at least one print and **none** have every minute of the 421-minute window. The fixed entry window has a print on **152** days, the exit window on **142**, and both on **115**. Thus 34 active dates cancel entry and **37 entered dates have no observed exit print**.

| Board period | Weekdays | Active | Entry print | Both prints | Entered without exit print |
| --- | ---: | ---: | ---: | ---: | ---: |
| TQTF, before 22 June | 122 | 116 | 96 | 74 | 22 |
| TQBR, from 22 June | 70 | 70 | 56 | 41 | 15 |

The missing-exit problem persists on both boards; it is not explained solely by the technical migration. Do **not** compute a 115-day paired-only win rate or claim independent 2026 validation of the 2025 TMON idea. Missing trade prints are not proof that there were no standing quotes. Forward contemporaneous bid/ask and actual fee/fill checks remain necessary. No orders were placed.
