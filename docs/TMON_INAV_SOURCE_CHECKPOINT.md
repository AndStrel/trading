# TMONA iNAV 2026 source checkpoint

The [source-only protocol](TMON_INAV_SOURCE_PROTOCOL.md) preceded any joint
TMON/iNAV trading outcome. Public MOEX ISS `TMONA` minute index candles were
saved with raw page hashes for all 135 weekdays 2026-03-23–2026-09-25.
Reproduce with `npm run build` and `node dist/research/tmon-inav-source.js`
for offline revalidation. The ignored manifest `.trading/tmon-inav-2026-source.json`
has SHA-256 `e1508ad98f28aae499d187ffb34564b03911ea0f63099683187b9b177463102e`.

The exact 10:00–17:00 iNAV minute window is complete on **133/135** weekdays.
The two missing dates are the previously identified special sessions
2026-05-01 and 2026-06-12. On only **4/133** ordinary days did the published
iNAV close change after 10:00; it was static in that window on the other
129. This makes it an occasionally updated fair-value reference, not a
rapidly responding intraday signal. The public index candles and their
timestamps do not establish when a real-time broker client would have
received the indicator or an executable TMON quote. No orders were placed.
