# TGLDB 2026 iNAV source checkpoint

The [source-only protocol](TGLD_INAV_SOURCE_PROTOCOL.md) was written before
the joint TGLD/iNAV outcome test. Public MOEX ISS `TGLDB` (RUB-denominated
iNAV) minute responses for all 133 ordinary weekdays 2026-03-23 through
2026-09-25 were saved with raw-page SHA-256 verification. Revalidate offline
with `npm run build` and `node dist/research/tgld-inav-source.js`. The ignored
manifest `.trading/tgld-inav-2026-source.json` has SHA-256
`47704b65734c19f9ebd2b545bd035615b4fb9a219827bcab5f2add8fd7bc5abc`.

All **133/133** dates have every 10:00–17:00 iNAV minute, and the published
close changes within that window on every date. This establishes timestamp
coverage, not that retail clients saw those values in real time or that TGLD
could be traded at the index value. The [MOEX index page](https://www.moex.com/ru/index/TGLDB)
states conditions for using index information to extract profit; operating a
strategy from it would require separate rights review. No orders were placed.
