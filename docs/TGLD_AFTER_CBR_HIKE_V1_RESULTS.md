# TGLD after scheduled CBR hikes v1 — rejected

The [rule](TGLD_AFTER_CBR_HIKE_V1.md) was frozen before TGLD window returns. Protocol SHA-256 `7f6415a84f3b645391b711a790668099baa455d0dd895b08554351bbaeaaf736`. TGLD TQTF daily SHA-256 `347575ab305338bcc9408be815366a5c12f37b164c10a5e08bf024a5e653ca2f` (939 rows, 2022–2025). CBR key-rate and SBMM hashes unchanged. Reproduce: `node dist/research-import-tgld-daily.js` then `node dist/research-tgld-after-cbr-hike.js`. Report: `.trading/tgld-after-cbr-hike-v1.json`.

| Book | Events | Hikes | Trades | Net winners | Mean TGLD net | Mean excess vs SBMM |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 2022–2023 | 16 | 5 | 5 | 1 (20%) | **−6.56%** | **−7.59%** |
| 2024–2025 | 16 | 3 | 3 | 3 (100%) | +5.28% | +4.55% |
| Combined | 32 | 8 | **8** | 4 (50%) | **−2.12%** | **−3.04%** |

**Reject.** Combined sample is below 20 trades; discovery is a large net loss versus cash-like SBMM. The three 2024–2025 winners are not a strategy. Do not flip this onto cuts or keep only the later window. No TGLD event overlay is added to paper trading. No orders.
