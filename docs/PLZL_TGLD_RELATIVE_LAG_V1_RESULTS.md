# PLZL vs TGLD 20-session relative lag v1 — rejected

The [rule](PLZL_TGLD_RELATIVE_LAG_V1.md) was frozen before PLZL returns. Protocol SHA-256 `5e4f46614d8c67a59907c3af11fab9ef63d6224f735fa22288c9562f5361f2d2`. PLZL TQBR daily SHA-256 `001bec15575548ca470b5ae3c4e529d6990583f3fc9426fb9369626422483d4c` (1,055 rows, 2022–2025). TGLD `347575ab305338bcc9408be815366a5c12f37b164c10a5e08bf024a5e653ca2f`. SBMM `6a70207aa52c48b620597cacadaab117de9d858711a1fae5047f2f075b88eca3`. Reproduce: `npm run research:import-plzl-daily` then `npm run research:plzl-tgld-relative-lag`. Report: `.trading/plzl-tgld-relative-lag-v1.json`.

| Book | Trades | Win rate | Mean net | Rule ending | PLZL hold | TGLD hold | SBMM hold |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2023–2024 | 48 | 72.9% | +5.42% | ₽1.630m | ₽1.785m | ₽2.012m | ₽1.283m |
| 2025 | 21 | 33.3% | −1.98% | ₽0.913m | ₽1.695m | ₽1.230m | ₽1.197m |
| Combined | 72 | 62.5% | +3.44% | ₽1.578m | **₽3.062m** | ₽2.534m | ₽1.548m |

Discovery passed trade-level gates; 2025 did not (year mean negative, win rate 33%). Combined sample 72 is below 100. Combined ending beat SBMM but lost to both PLZL and TGLD holds. Combined drawdown −21.1%.

**Reject.** Miner-vs-gold lag is not admitted. Do not reverse to buy-strength on this sample. No PLZL overlay is added to paper. No orders.
