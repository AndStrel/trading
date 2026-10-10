# Si 11:01-entry oracle ceiling — diagnostic protocol

Fixed before calculation. This is a deliberately **unattainable upper bound**,
not a trading rule. Use the sealed 2026 Si RFUD exact-contract one-minute
source (manifest SHA-256 `ed8c32be0f099e8caeb8d773b6edaa7cac08e397c326fe2135ba810e56c36b74`),
ordinary dates 2026-03-23 through 2026-09-25, excluding preidentified
special sessions 2026-05-01 and 2026-06-12. Require the full 10:00–10:59
signal, exact 11:01 entry minute, and all 11:02–16:55 candidate exit minutes.

At 11:00 take the sign of 10:59 close versus 10:00 open. Evaluate two
**separate** fixed directions, first-hour continuation and first-hour
reversal. Enter at 11:01 open. For a long, choose the highest later minute
high; for a short, choose the lowest later minute low. The choice uses future
information and an assumed fill at the daily extremum, so actual achievable
returns can only be worse under this execution model. Apply Investor futures
commission 0.10% per side and 0.05% adverse execution per side; repeat under
0.10% adverse execution per side. Report eligible/missing days, base-net
oracle-win days and mean oracle net by direction. 51% is the screening bar.

If a direction's oracle bound fails 51%, no realistic exit on this fixed
entry/direction/window can pass the win-rate gate under the model. If it
passes, that proves **nothing** about a predictive exit, fill or net profit.
No orders. Tariff reference: [T-Invest](https://www.tbank.ru/invest/help/brokerage/account/get-bs/tariff/).
