# Cloudflare: real headers for /facebind/

GitHub Pages cannot set response headers, so the page's `<meta>` Content-Security-Policy is all that applies when it is
served directly. A `<meta>` CSP is weaker: it does not cover the bytes before it, it cannot set `frame-ancestors`, and
it is part of the document the host serves. Real headers added at Cloudflare close those gaps.

## Check first: is the site actually behind Cloudflare?

```bash
curl -sI https://tejaswigowda.com/strata-editor/facebind/ | grep -i -E '^(server|cf-ray)'
```

You should see `server: cloudflare` and a `cf-ray` header. When this was audited (2026-10-11) the response was
`server: GitHub.com` with no `cf-ray`, i.e. **the domain was not proxied by Cloudflare**, so the headers could not
be applied yet. In the Cloudflare dashboard, set the DNS record for the domain to *Proxied* (orange cloud) first.

## The headers

[`facebind-headers.json`](facebind-headers.json) is the single source:

| Header | Value |
|---|---|
| `Content-Security-Policy` | the page's `<meta>` policy, plus `frame-ancestors 'none'` |
| `Referrer-Policy` | `no-referrer` |
| `X-Content-Type-Options` | `nosniff` |
| `Permissions-Policy` | `camera=(self), microphone=(), geolocation=(), interest-cohort=()` (the page's webcam selfie; the embedded editor keeps `camera=()`) |

`docs/editor/js/facebind/__tests__/page.test.mjs` fails if the CSP here drifts from the `<meta>` in
`docs/facebind/index.html`. Keep the `<meta>` as the fallback for direct-origin loads: when both are present the
browser enforces both.

## Option A: Transform Rule (no code)

Rules, Transform Rules, **Modify Response Header**, create a rule:

- When: a custom filter expression: `starts_with(http.request.uri.path, "/strata-editor/facebind")`
- Then: **Set static** each header above, with the values from the JSON.

## Option B: Worker

[`facebind-headers.worker.js`](facebind-headers.worker.js) with [`wrangler.toml`](wrangler.toml): set your zone and
route, then `npx wrangler deploy`. It passes the request through to the origin and adds the headers for the facebind
path only.

## Verify

```bash
scripts/check-facebind-headers.sh                       # live
scripts/check-facebind-headers.sh https://example/path  # any URL
curl -I https://tejaswigowda.com/strata-editor/facebind/
```

The script exits non-zero if the CSP, Referrer-Policy or nosniff header is missing or differs from the JSON, and prints
a note if the response did not come from Cloudflare.

## What this does not fix

A compromised or malicious host (or a compromised Cloudflare account) can still serve different code and different
headers. That needs a pinned, reviewed commit or a local copy; see `guides/FACE_BIND_PRIVACY.md`.
