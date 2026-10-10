# ROSN vs USD/RUB 20-session relative lag v1 — data abort

The [rule](ROSN_USDRUB_RELATIVE_LAG_V1.md) was frozen before ROSN/USD returns. Protocol SHA-256 `5cac21f1617be27a92e56666895ce699b4de81b90d8791cb6761b49d203d0c0c`.

ROSN TQBR daily imported successfully: 1,317 rows, SHA-256 `68f0731e9cf77b4add121411753e2d6805f081a8dec6b8d157cb865e1d274d06`.

USD000UTSTOM CETS daily `interval=24` (null `volume` stored as 0): 2021=255, 2022=252, 2023=254, **2024=112**. The importer aborted on the frozen 150–400 yearly floor before 2025 and before any lag simulation. CETS was the only board named in the protocol; no other FX board was substituted.

This is a **source-coverage failure**, not a trading reject. It does not authorize a different USD ticker, a different year split, or reversing the exporter rule. No overlay. No orders.
