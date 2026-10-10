# TGLD 2024 intraday source checkpoint

Public MOEX ISS TGLD TQTF one-minute trade candles, 10:00–17:00 MSK, are in the ignored local archive `.trading/tgld-2024-source/`. The ignored manifest `.trading/tgld-2024-source.json` has SHA-256 `015c36e9b6ef1cbb0403c535c7bd5ca7d568291d7f17a6540c94aa720b55a7bc`. Every response is separately SHA-256 checked on read.

Of 262 calendar weekdays, 253 have any candles. Exactly 252 have a 10:00 first candle, and 252 have a final candle at or after 16:55. The other dates and missing exact boundaries must remain visible in strategy decisions. No trading outcome was calculated from this 2024 archive at this checkpoint. Past prints are not executable quotes or fills.
