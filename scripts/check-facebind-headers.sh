#!/bin/sh
# Check that the live face-bind page is served with the real security headers.
#   scripts/check-facebind-headers.sh [url]
# Exits non-zero if the Content-Security-Policy or Referrer-Policy header is missing or different from
# ops/cloudflare/facebind-headers.json.

URL="${1:-https://tejaswigowda.com/strata-editor/facebind/}"
CONFIG="$(cd "$(dirname "$0")/.." && pwd)/ops/cloudflare/facebind-headers.json"
HEADERS="$(curl -sI --max-time 20 "$URL")" || { echo "could not fetch $URL"; exit 2; }

fail=0
for name in Content-Security-Policy Referrer-Policy X-Content-Type-Options; do
  want="$(node -e "const c=require('$CONFIG');process.stdout.write(c.headers['$name'])")"
  got="$(printf '%s\n' "$HEADERS" | tr -d '\r' | grep -i "^$name:" | sed "s/^[^:]*: *//")"
  if [ "$got" = "$want" ]; then echo "ok      $name"; else echo "MISSING $name"; echo "  want: $want"; echo "  got:  ${got:-<none>}"; fail=1; fi
done

printf '%s\n' "$HEADERS" | tr -d '\r' | grep -iq '^server: cloudflare' || echo "note: the response is not from Cloudflare (server header: $(printf '%s\n' "$HEADERS" | tr -d '\r' | grep -i '^server:' | sed 's/^[^:]*: *//')). The headers can only be added once the domain is proxied by Cloudflare."
exit $fail
