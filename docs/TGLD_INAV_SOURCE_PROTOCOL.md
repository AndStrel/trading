# TGLDB iNAV source — research-only checkpoint before strategy results

Freeze before calculating TGLD/iNAV strategy outcomes. Use public MOEX ISS
rub-denominated `TGLDB` (not USD-denominated `TGLDA`) minute candles on the
`INAV` index board for the same 133 ordinary dates as the existing TGLD 2026
trade-price archive, 2026-03-23 through 2026-09-25. Preserve each raw page
and SHA-256; never replace an existing snapshot. Validate same-date ordered
timestamps and positive OHLC. Report exact 10:00–17:00 coverage and number of
days with more than one iNAV close in that window. No TGLD price outcomes or
signal thresholds are to be inspected in this source checkpoint.

This is read-only research, not execution. MOEX's [iNAV page](https://www.moex.com/ru/index/TGLDB)
states conditions for using index information to extract profit; legal/data
rights must be resolved before operational use. Public minute candles are
not an executable or necessarily real-time quote.
