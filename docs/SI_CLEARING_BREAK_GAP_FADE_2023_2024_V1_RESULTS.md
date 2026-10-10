# Si post-clearing gap fade — rejected on historical sessions

The [historical-session protocol](SI_CLEARING_BREAK_GAP_FADE_2023_2024_V1.md)
was frozen before calculating this rule's outcomes. Protocol SHA-256:
`e398534fc0b6c1ce06410c22cdb04084aba2f2e1a133f95831abd943efde77ac`.
The 232-file compressed archive inventory matched SHA-256
`bcffb767570bf75bd61c922494dd80d15739563773cb600dd0cd5532498ca5a3`; every
cached page hash was checked. Full machine report:
`.trading/si-clearing-break-gap-fade-2023-2024-v1.json`, SHA-256
`f8b05231a1ae1e9a7ce7152d02fa04575eca075544e006fa72ec8dde7991b566`.
Reproduce with `npm run build` and
`npm run research:si-clearing-break-gap-fade:2023-2024`.

Across 232 archived weekdays, one verified no-session date and the special
2023-11-06 holiday session were excluded. One session lacked a required signal
anchor. Of the **184 completed trades**, only **30 were net-positive (16.3%)**
after the fixed base cost model. Two further signals had unresolved holding
paths and remain unscored; they are not counted as wins. There were no
cancelled entries. Completed-trade mean gross was −0.0028%; mean base net
**−0.3028%** and mean stress net −0.4028%. Profit factor was 0.175; total base
net −55.71 percentage points of entry notional, or −56.91 points after
removing the best trade. Exits: 39 stops, 2 targets, 143 time exits.

Neither year passed: 2023 had 10/93 net winners (10.8%) and −0.3709% mean base
net; 2024 had 20/91 (22.0%) and −0.2331%. Every contract group had negative
mean base net; stress mean was also negative in every period.

**Decision:** reject this exact historical clearing-gap fade. It fails the
net-win, expectancy, stress, and zero-unresolved gates by wide margins. Do not
retune the gap direction, stop, target, or times on these dates. This is
exploratory because the source dates were already used for a separate opening
compression study; it is not independent confirmation. Minute bars still do
not establish actual spreads, queue fills, market impact, margin safety,
taxes, or account P&L. No orders were placed.

The separate [2026 attempt was invalidated](SI_CLEARING_BREAK_GAP_FADE_V1_RESULTS.md):
MOEX had already cancelled its intermediate clearing pause in that sample.
Its accidental clock-time-fade metrics are not included here.

Implementation hashes: evaluator
`b62b842f320f3ed33c873466883a6e6f008d543c4e449301225b1e7709c0a9f7`, runner
`f31608a0b428dd43af02398d687d3b0acedb015c848cb8f24fb2a8170145ad26`, tests
`d0cf03cdb895f73d483f76c5dbc025f673f675cfb7b29c4a87d7fbe6c09cfe65`.

Calendar sources: [MOEX historical 14:00–14:05 clearing pause](https://www.moex.com/n12165?nt=106),
[2023 trading calendar](https://www.moex.com/n51887),
[2024 trading calendar](https://www.moex.com/n64121).
