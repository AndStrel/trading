# SBMX / TGLD / SBMM dual momentum v1 — rejected

The [rule](SBMX_TGLD_SBMM_DUAL_MOMENTUM_V1.md) was frozen before overlay equity. Protocol SHA-256 `57d80b013f72d034ac781d3183e447c7117915258fe4217a5b211958040d81b7`. SBMX `5f1f0e533a4bfc05d88014b3052245ffb55b430faebb9a23289521672effe64b`. TGLD `347575ab305338bcc9408be815366a5c12f37b164c10a5e08bf024a5e653ca2f`. SBMM `6a70207aa52c48b620597cacadaab117de9d858711a1fae5047f2f075b88eca3`. First signal **2022-10-03** (120-weekday warmup). Reproduce: `npm run research:sbmx-tgld-sbmm-dual-momentum`. Report: `.trading/sbmx-tgld-sbmm-dual-momentum-v1.json`.

| Book | Switches | Overlay ending | SBMX hold | TGLD hold | SBMM hold | Overlay DD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 2022-10-03–2022-12-31 | 1 | ₽1.247m | ₽1.151m | ₽1.241m | ₽1.010m | −3.4% |
| 2023 | 2 | ₽1.310m | ₽1.500m | ₽1.405m | ₽1.085m | −8.0% |
| 2024 | 2 | ₽1.290m | ₽1.003m | ₽1.420m | ₽1.174m | −13.0% |
| 2025 | 4 | ₽0.936m | ₽1.015m | ₽1.230m | ₽1.197m | −23.7% |
| Combined | 8 | ₽2.134m | ₽1.809m | **₽3.189m** | ₽1.577m | −24.1% |

The overlay beat SBMX and SBMM holds with only eight switches and combined DD milder than −25%, but lost to always-TGLD and the 2025 book ended below ₽1m.

**Reject.** Do not drop gold, change 120, or skip 2025. No overlay is added to paper. No orders.
