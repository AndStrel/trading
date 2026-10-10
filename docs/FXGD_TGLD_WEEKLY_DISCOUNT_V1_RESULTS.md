# FXGD vs TGLD weekly gold-vehicle discount v1 — data abort

The [rule](FXGD_TGLD_WEEKLY_DISCOUNT_V1.md) was frozen before any FXGD returns. Protocol SHA-256 `7acd7501408f426d2f771ac5aae22adc1be8a8e45c9f3709d67af8fc7bdfa766`.

`npm run research:import-fxgd-daily` probed TQTF then TQBR. 2024 TQTF had fewer than 150 daily rows, so the importer selected TQBR. TQBR 2022–2023 counts were **0**. The run aborted on the frozen 150–400 coverage floor **before** any discount simulation. TGLD and SBMM hashes were not scored against FXGD.

This is a **source-coverage failure**, not a trading reject of a computed edge. It does not authorize substituting another gold ticker or reversing the rule. No overlay. No orders.
