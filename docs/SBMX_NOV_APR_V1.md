# Frozen protocol: SBMX November–April calendar v1

Research only; no orders. Tests the Halloween / “sell in May” calendar on an IMOEX ETF, not a 20-session relative-lag or momentum filter.

Hypothesis: long SBMX from the first weekday session on or after **1 November** through the first weekday session on or after **1 May**, cash otherwise, beats Investor round-trip costs versus sitting in SBMM and versus always holding SBMX. One round trip per winter.

## Source

Frozen MOEX ISS TQTF daily SBMX and SBMM through 2025-12-30. No 2026 prices. Weekday sessions only. A winter that would exit in 2026 is not opened.

## Rule

Label winters by the November entry year. Eligible entries: 2021, 2022, 2023, 2024. Buy SBMX at the open of the first weekday bar with `day >= YYYY-11-01`. Sell at the open of the first weekday bar with `day >= (YYYY+1)-05-01`. Skip the winter if either session is missing. At most one position. Investor 0.3% + 0.05% slippage per side; stress 0.10%. Paired SBMM control uses the **same** entry/exit calendar dates and the same costs (winter-only SBMM, not continuous cash).

Discovery: entry years 2021–2022. Validation: 2023–2024. Combined: 2021–2024.

Also report SBMX buy-and-hold and SBMM buy-and-hold from the first combined entry day through the last combined exit day.

## Gates

Meeting frequency makes 100 trades impossible; floor is **all 4 winters completed** (no unresolved). Combined: ≥51% SBMX net winners, positive mean SBMX net and stress mean, profit factor >1 or all wins, **mean(SBMX net − paired SBMM net) > 0**, and combined ending of the SBMX calendar rule (₽1m, sequential winters, cash between) > SBMX buy-and-hold and > SBMM buy-and-hold on that same first-entry-to-last-exit window. Discovery and validation each need positive mean SBMX net and positive mean excess vs paired SBMM.

Fail → reject. Do not then test May–October on this sample. Not live authorization.
