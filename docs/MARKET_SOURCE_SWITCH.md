# Server / computer market-data selection

The Mini App source controls select market data only. The execution client, production
account, kill generation and order journal do not move. Orders never fail over.

A source can be selected only after a successful broker metadata probe in the last
60 seconds. Selection is refused while any scanner pass holds a source lease.
Failed local requests are not retried on the other source. Restart defaults to server.
A source change invalidates the last scanner report; a failed universe refresh also
invalidates the old report. Prior candidate journal entries are not trade permission.

Flags describe egress-IP country attributed by https://country.is/, independently
of broker availability. Country data expires after 24 hours; unknown is shown as 🌐.
The provider receives no broker key and its returned IP is discarded.

## Private channel

The local relay uses only the read credential from `/run/private/snapshot.json`
and a separate random shared secret from `/run/private/relay-secret`. The local
container must publish **only** `127.0.0.1:13877:13877`, never an all-interface host port.
It accepts authenticated market metadata/candles/order-book/last-price/status reads
and geolocation only. Account and trading methods are not in its allowlist.

An SSH remote Unix-socket forward exposes `/run/relay/market.sock` to the server
container via a read-only mount. The host directory/socket must be accessible only
to the operator and container group, with no public TCP listener. Configure:

- `T_INVEST_LOCAL_RELAY_DIR`: private host directory mounted at `/run/relay`.
- `T_INVEST_LOCAL_RELAY_URL=http://127.0.0.1:13877/market-data` (virtual HTTP URL).
- `T_INVEST_LOCAL_RELAY_SOCKET=/run/relay/market.sock`.
- `T_INVEST_LOCAL_RELAY_SECRET_PATH=/run/relay/secret`.

The shared secret and broker keys are never committed. The SSH channel does not
disable broker TLS validation. Reconnection must not remove an unverified existing
socket or restart an unknown tunnel. Computer sleep/disconnection makes the source
unavailable; it does not relocate execution or permit orders.

This feature is not sandbox round-trip acceptance or permission to trade live.
