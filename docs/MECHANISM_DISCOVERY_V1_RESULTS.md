# Mechanism discovery v1 — all candidates rejected

The [round contract](MECHANISM_DISCOVERY_V1.md) was frozen before outcomes. Protocol SHA-256 `b4a4dd34f6f0ab43d9d99b77bda19bcde536eee10015c97fa6ad0d963a1edbc1`. Reproduce: `npm run research:mechanism-discovery`. Ledger: `.trading/mechanism-discovery-v1.json`.

SBER/GAZP 2023–2025 minute archives; Investor 0.3% commission and 0.05% slippage per side. Discovery on previously studied history, not independent validation.

| Mechanism | Trades | Base win rate | Mean base net |
| --- | ---: | ---: | ---: |
| Relative lag | 7 | 28.6% | −42.9% |
| Selling exhaustion | 15 | 20.0% | −52.7% |
| Compression breakout | 1 | 0.0% | −71.3% |
| Control (daily entry) | 1008 | 16.1% | −72.4% |

None met the 100-trade / 51% winner / positive yearly economic gates. **Decision:** reject all three mechanisms for this round; do not retune thresholds. No trading authorization.
