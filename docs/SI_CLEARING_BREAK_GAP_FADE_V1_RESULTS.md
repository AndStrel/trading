# Si post-clearing gap fade v1 — invalidated by schedule mismatch

The [protocol](SI_CLEARING_BREAK_GAP_FADE_V1.md) was frozen before the
calculation (SHA-256
`2f77aa7b3ef53a052c2e49ca42c6ffaaaa41421be07587799b139e0efdda2f96`), and the
locked Si source manifest hash matched
`ed8c32be0f099e8caeb8d773b6edaa7cac08e397c326fe2135ba810e56c36b74`. The
machine report `.trading/si-clearing-break-gap-fade-v1.json` has SHA-256
`fae5a45c2e901ce5e615bd912b90bc725ff645c67c84dbe0c9089890777fca83`.

**The run is invalid as a test of a post-clearing gap.** MOEX's current
official schedule says that from 23 March 2026 the derivatives market moved
to continuous trading and the intermediate clearing break was cancelled
([official schedule](https://www.moex.com/ru/derivatives/unified-trading-session)).
The test window starts on that same date. The evaluator compared the 13:59
close with the 14:05 open, but 14:00–14:04 were trading minutes, not a
non-trading clearing interval. The measured feature was therefore a short
clock-time return, not a clearing gap. This calendar check should have been
done before freezing and running the candidate.

The raw diagnostic output had 128 modeled trades, 20 net-positive outcomes
(15.6%), −0.3236% mean base net, and no target exits. These numbers describe
only that accidentally tested clock-time fade. They **must not** be treated as
evidence for or against a true clearing-gap mechanism, used to tune a new
version, or counted toward the strategy-admission gate.

**Decision:** invalidate this run; do not label the clearing-gap hypothesis
rejected. A new test must use dates before 23 March 2026 when the intermediate
clearing pause actually existed. This 2026 source is already used in related
research and cannot serve as independent confirmation. No orders were placed.

Implementation hashes: evaluator `c4dd021e0bd5809a0daae55e865a7b2e2cd29220a18ee3ca3db9fc9e6d0e5d16`,
runner `0b19364bd6eeb4219d7bbe85964b8a6c8d89d452b64c283b2d86f869e9152182`,
tests `d0cf03cdb895f73d483f76c5dbc025f673f675cfb7b29c4a87d7fbe6c09cfe65`.
