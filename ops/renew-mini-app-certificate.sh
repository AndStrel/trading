#!/usr/bin/env bash
set -euo pipefail
# Independent config/account copy: never touches BrewNote's certificates or Python.
tls_root=/opt/andstrel/trading-tls
test -d "$tls_root/letsencrypt/renewal"
docker run --rm --read-only --cap-drop=ALL --security-opt=no-new-privileges \
  --tmpfs /tmp:rw,noexec,nosuid,size=32m \
  -v "$tls_root/letsencrypt:/etc/letsencrypt" \
  -v "$tls_root/work:/var/lib/letsencrypt" \
  -v "$tls_root/logs:/var/log/letsencrypt" \
  -v /var/www/trading-acme:/var/www/trading-acme \
  certbot/certbot@sha256:f70ad0adbb7e117f0fe42a63c553f28ea451edabc0148757b6efcd9735acaa20 \
  renew --cert-name bot.brewnote.net --non-interactive --no-random-sleep-on-renew "$@"
nginx -t
systemctl reload nginx
