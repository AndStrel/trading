# SBGB/SBMM CBR policy-regime overlay v1 — rejected

The [rule](SBGB_CBR_POLICY_REGIME_V1.md) was frozen before overlay equity. Protocol SHA-256 `a5e400cf6779e59d7506a35c5d7e310ed12462db02ae55508115f4b04069b8bd`. CBR key-rate `91da3d92eaef46b4631f2504aee49dc47aa6520b05681e221b9aa35c90d82620`. SBGB `ea9f54cd20cbb14f65fc98656bb9cae23a1df23b35a4bb044304ffb53cc1a36a`. SBMM `6a70207aa52c48b620597cacadaab117de9d858711a1fae5047f2f075b88eca3`. Reproduce: `npm run research:sbgb-cbr-policy-regime`. Report: `.trading/sbgb-cbr-policy-regime-v1.json`.

| Book | Switches | Overlay ending | SBGB hold | SBMM hold | Overlay DD |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2021–2023 | 4 | ₽1.149m | ₽0.996m | **₽1.221m** | −7.7% |
| 2024–2025 | 1 | ₽1.429m | ₽1.214m | ₽1.417m | −5.0% |
| 2022 only | 3 | ₽1.068m | ₽1.026m | ₽1.099m | −7.7% |
| Combined | 5 | ₽1.654m | ₽1.216m | **₽1.743m** | −7.7% |

The overlay beat always-holding SBGB and kept 2022 above ₽1m with drawdown milder than −25%. It still lost to the SBMM cash sleeve on discovery and combined.

**Reject.** Do not invert to SBGB-after-hikes. No duration overlay is added to paper. No orders.
