# CDN independence: nothing durable names a provider

**Status: jsDelivr serves, the rest is plumbing.** Renders are shared at their jsDelivr address today. Every new `render.json` already records the permanent canonical address and carries `files.sha256`, and the player, the verifier, the Worker and the sync workflow exist, so going live is a routing change plus one flag, not a migration. The two switches are in one place, `DELIVERY` in `docs/editor/js/export/releases.js`:

| Switch | Today | Effect when turned on |
| --- | --- | --- |
| `canonicalLive` | `false` | the editor hands out `https://strataeditor.dev/video/<name>/v<N>/` as the share link. Off, it hands out the first mirror (jsDelivr), and the canonical address is only recorded. |
| `archive` | `false` | a new publication lists the Internet Archive item as a mirror. Off, it does not claim a mirror that is not uploaded. |

Turning either on edits no published artifact and no page: the canonical address is already in every new `render.json`, and links made while it was off keep working. Order of operations when going live: do the runbook below, publish one render, `node tools/verify-publication.mjs <canonical> --require 1`, then set `canonicalLive: true`.

The rest of this page describes the end state.

A published render's address is `https://strataeditor.dev/video/<name>/v<N>/`. Where the bytes are served from is a routing rule; the repository is the source of truth; every other copy is a listed mirror. This is the same rule as ids-not-paths, one layer out.

Why not the old address: `https://cdn.jsdelivr.net/gh/tejaswigowda/renders@cafe/v1/cafe/` is pinned against content drift (a tag never moves) and protected against nothing else. jsDelivr is free infrastructure for package assets, GitHub discourages repositories as a content delivery network, and neither has promised anything. Every tutorial, `render.json`, shared link and citation would have had `jsdelivr.net` in it. The files were always immutable, content-addressed and ours, so the dependency was reversible; the hostname in a published link is the one thing that is not, which is why it is decided before the next render publishes.

## The decision, and why

**A path on the existing origin, not a new domain.**

1. **No CORS.** Cross-origin HLS needs correct headers on the playlists and on every segment, and a mistake fails differently in each browser. Same origin as the player needs none. (The Worker still answers `Access-Control-Allow-Origin: *`, so a page elsewhere can embed it.)
2. **No provider name in any published URL.**
3. **A third-party URL becomes the exception** in the player's fragment, which makes an interstitial or allowlist for those natural. (Not done: out of scope.)

`strataeditor.dev` is served by GitHub Pages, which caps out around 1 GB of site and 100 GB a month. At about 122 MB a short that is six shorts. So `/video/*` is routed in front of Pages to storage, and storage becomes a routing rule:

```
strataeditor.dev  →  Cloudflare (DNS + proxy)
  /video/*        →  Worker → R2 bucket        infra/cloudflare/video-worker.js
  everything else →  GitHub Pages, unchanged   (no route matches it)
```

## What a publish does

1. The editor commits the ladder to `tejaswigowda/renders` and tags it `<name>/v<N>` (as before). The folder now also holds `files.sha256`.
2. The tag push runs `infra/renders-repo/sync-render.yml` in the renders repository, which
   - **storage job:** checks the committed folder is exactly what `files.sha256` lists, copies it to `r2://…/video/<name>/v<N>/` (never deleting: tags are immutable), then fetches every file back **from the public address** and compares it with the manifest;
   - **archive job:** uploads the same folder as one Internet Archive item.
3. The editor's share link is `shareBase()`: the canonical address once `DELIVERY.canonicalLive`, until then the first mirror. With the switch on, the panel checks after publishing whether that address answers yet and says so (the link already plays meanwhile, because the player falls back to the mirrors). With it off, the panel says the permanent address is recorded and not routed yet.

One departure from "the publish action writes to two places": the browser commits and tags, and the **tag push** does the second write. R2 and Internet Archive credentials then live in the renders repository's secrets and never in a browser tab holding a GitHub token. The result is the same: idempotent, and verified against `files.sha256`.

## `render.json` `publication`

```json
"publication": {
  "canonical": "https://strataeditor.dev/video/cafe/v2/",
  "source":   { "repo": "tejaswigowda/renders", "tag": "cafe/v2", "path": "cafe" },
  "mirrors": [
    "https://cdn.jsdelivr.net/gh/tejaswigowda/renders@cafe/v2/cafe/",
    "https://archive.org/download/strata-cafe-v2/"      // only once DELIVERY.archive; today the list is the jsDelivr line alone
  ],
  "target": "generic",
  "constraints": { "max_file_bytes": 20971520, "target_segment_s": 6 },
  "size_bytes": 122569327
}
```

- `canonical` is the first place a player looks. Its path is the tag, so it is pinned by construction.
- `source` is the source of truth: the folder `<path>/` of `<repo>` at `<tag>`.
- `mirrors` are in the order to try. Only this field may name a provider.
- `constraints` records the limits that shaped the ladder. Six-second segments under a 20 MB cap was jsDelivr's limit shaping the ladder; written down it is a deployment decision, unwritten it reads as a fact about HLS and the next person inherits a constraint from a provider already left.
- `size_bytes` is every file except `render.json` and `files.sha256`.
- Schema: `docs/schemas/render.schema.json` (`oneOf` the two shapes). Code: `publicationBlock`, `validatePublication`, `publicationOf` in `export/releases.js`. `publicationOf` returns one shape for both, so nothing downstream branches on which a render has.

The old shape (`storage, repo, path, tag, url, size_bytes`) is still valid and still read. `publicationOf` lists its pinned `url` as the one mirror, so what is reported is where the bytes actually are.

## `files.sha256`

`<sha256>  <path>` per file, sorted, paths relative to the folder: the format `sha256sum -c` / `shasum -a 256 -c` reads (tested against the real `shasum`). It lists every file (playlists, segments, poster, captions, `render.json`) except itself; `render.json` declares it in `outputs.manifest`, and the publish gate refuses a set that declares it and lacks it. Frame hashes are taken before encoding and cover no segment; this is what covers the bytes.

```sh
node tools/verify-publication.mjs https://strataeditor.dev/video/cafe/v2/            # every location of the render, each against its own manifest
node tools/verify-publication.mjs https://strataeditor.dev/video/cafe/v2/ --require 1 # at least one must verify (a slow archive does not block)
cd cafe && shasum -a 256 -c files.sha256                                              # by hand
```

Each location comes back `verified`, `incomplete` (files missing: a half-synced mirror), `different` (other bytes, or a manifest that is not the first location's) or `unverifiable` (no manifest). Only `verified` counts.

## The player

`resolve.js` `candidateBases` gives the order: the address it was opened at; the render's `canonical` and `mirrors` in their order (before `render.json` has been read, the convention `jsdelivr…@<tag>/<slug>/` and the archive item stand in); then the other jsDelivr hostnames. `render.json` is read from the first of those that answers (a canonical host that is down must not take the title, poster and captions with it); hls.js, the native `<video>` and the download all fail over from where they got to. Timeouts: 6 s to first byte on a host that has a successor, one timeout retry, 10 s to start on native HLS, 60 s per downloaded file; the last host is waited for. `video/cafe/v1` is accepted as a short form.

## Trip wires for staying on Pages

Staying on Pages and jsDelivr is right while the move stays cheap. The exits, so they are not learned from breakage:

| Signal | Threshold | Action |
| --- | --- | --- |
| Pages site size | **700 MB** of tracked `docs/` (Pages caps a site at about 1 GB; today 224 MB) | begin the move to storage (the runbook below). `node tools/size-check.mjs` measures it and exits 1 over the threshold. |
| Encoded video in the editor repository | any file | none belongs here: renders live in the renders repository, which is already where they are published. `size-check` fails on it (one 16.7 MB tutorial demo, `pyth.mp4`, is grandfathered). |
| Pages bandwidth | GitHub's warning email (about 100 GB a month, a soft limit) | the address must be one you read: **github.com/settings/emails, primary address** (this cannot be read or set from here: the token has no `user` scope, and the setting is not in the API). Act on the first warning: the move is the runbook. |
| jsDelivr | none visible; they can block without notice | contained: it is a mirror, `render.json` lists the others, the player falls back, and `verify-publication` says which locations still serve the right bytes. |

At 47 MB (`bus-stop`) to 122 MB (`cafe`) a render, none of these is near, and the editor repository does not hold the bytes.

## `docs/video` as a submodule of the renders repository: decided against, for now

The idea: Pages serves `docs/`, so `docs/video` as a submodule of `tejaswigowda/renders` would keep the URL and the bytes out of the editor clone. Checked against how the renders repository is laid out, it does not fit:

- **The path has a version in it and the repository does not.** A submodule checks out one commit of one branch, which holds `<name>/` (the latest files; publishing removes what the new set lacks). Pages would serve `/video/<name>/master.m3u8`, not `/video/<name>/v1/master.m3u8`, and a v2 would replace v1 at the same URL. Tags are the versions, and a submodule cannot expose a tag as a directory. Making it work means changing the renders layout to `<name>/v<N>/` directories, which gives up the one-folder-per-scene, tag-per-version design the publish code and every published `render.json` (`source.path`) rely on.
- **Every publish would need a commit to the editor repository** to move the submodule pointer, so the tag push is no longer the whole publish action.
- **It does not address the cap.** Pages' 1 GB limit counts what it serves, submodule or not; it only keeps the clone small.

The editor repository gains no encoded video either way, and `DELIVERY.canonicalLive` is off, so nothing needs serving from `docs/video` now. Revisit at the 700 MB trip wire; at that point the Worker and R2 plan above does the same job without the pointer commits.

## Existing renders are not touched

`short/v1` was the first render published through the new path (before the `DELIVERY` switch, so its `publication` claims a canonical address that is not routed and an archive mirror that was never uploaded; only its jsDelivr location verifies). It is being replaced by `bus-stop/v1`, a re-render under the content's name with the record fixes of the first-render work order; the `short` tag and folder are deleted once that is published and verified.

`cafe` (`renders@cafe/v1`), `a+b-cubed` (`renders@a+b-cubed/v1`, and the older copy in `test1`) and `projectile` keep serving where they are, and every address form that reached them still resolves. They have no canonical address and no `files.sha256`, and tags never move, so they cannot gain either: they migrate when re-rendered. Until then `verify-publication` reports them `unverifiable`, which is true.

## Gates

| Gate | State | Evidence |
| --- | --- | --- |
| **G1** editor, tutorials and STOA explorer unaffected by the proxy | **before taken; after not possible yet** | `ops/site-check/before-2026-11-03.json`: 38 URLs (core pages, the sitemap, entry scripts, assets), all answered by GitHub Pages. After the DNS change: `node tools/site-check.mjs snapshot --out ops/site-check/after.json && node tools/site-check.mjs compare ops/site-check/before-2026-11-03.json ops/site-check/after.json`. The STOA explorer is not served from this origin: pass it with `--url`. |
| **G2** no published URL contains a provider name | **plumbed, off by choice** | Only `publication.mirrors` names a provider (a test asserts the rest of the block does not). The share link is jsDelivr until `DELIVERY.canonicalLive` is set, so today's links still name it. "Published URL" is read as the address a render is shared and cited at, not the mirror list, which names providers by design (§D). Renders already published still have jsDelivr addresses (§F). |
| **G3** `publication` carries canonical, source, mirrors, target, constraints | done | `releases.test.mjs`, schema. |
| **G4** player falls back through mirrors, with a timeout | done | `resolve.test.mjs`; in Chrome, a canonical host that serves then 404s from segment 5: playback continued 40 s → 60 s on the mirror, with the note and no error. |
| **G5** `files.sha256` published; the R2 sync is verified against it | **manifest, verifier, sync script done; the R2 sync itself not run** | `filesManifest.test.mjs`, `verify-publication.test.mjs`, `infra/renders-repo/__tests__/sync.test.mjs` (passes; refuses a changed file, an unlisted file, a half-synced or wrong-bytes storage). Needs the R2 bucket and secrets. |
| **G6** every currently published link still resolves | done | The six address forms of the four published folders resolve with the new code and answer 200 (`cafe/v1`, `a+b-cubed/v1`, the `test1` copies). |
| **G7** one mirror on infrastructure you neither pay for nor control | **plumbed, off** | With `DELIVERY.archive`, `archive.org/download/strata-<name>-v<N>/` is listed in each new `publication`, and the `archive` job uploads it. Off, nothing is claimed. Needs `IA_ACCESS_KEY`/`IA_SECRET_KEY`. jsDelivr and raw GitHub also qualify as free infrastructure, but a preservation mirror is the Internet Archive. |
| **G8** switching storage needs a routing change and no edit to a published artifact | by design | No artifact names storage. The R2 bucket is a binding in `wrangler.toml`; moving to Bunny or another bucket changes the Worker, not a manifest or a page. |

## What was not done, and what was not checked

- **No DNS, Cloudflare or R2 change was made**, and none is needed to keep working: with `canonicalLive` off, nothing hands out an address that does not answer. The canonical address returns 404 until the runbook is done; a player opened on one still plays, from the mirrors.
- **The Worker is tested against a fake R2 bucket** that implements the behaviour the Worker relies on (range, conditional, bodiless object on a failed precondition). It has not run on Cloudflare. Check `curl -I` and a Range request after deploying.
- **`sync-render.yml` and the Internet Archive upload have not run.** `sync.sh` is tested; the `aws s3 sync` and `ia upload` lines are not. Whether archive.org serves `/download/` files with CORS headers (the player, on another origin, needs them) is **unchecked**.
- **The Publish panel was not driven through a real publish** (it needs an offline render and a GitHub write). Its modules load in Chrome, and the set-building, gate, commit and verification are tested in node.
- Not in the Cloudflare plan: Workers' free tier has a daily request cap (100k); a play is tens of requests, so it is not close, but it is a limit.

## Runbook (needs your accounts)

Do G1 first; each step can be undone by pointing the nameservers back at GoDaddy.

1. **Before.** Already taken (above). Take another immediately before the change if the site has moved.
2. **Cloudflare:** add `strataeditor.dev` (free plan). Check the imported records against the current ones (`A 185.199.108-111.153` for the apex, plus anything else GoDaddy holds, such as MX/TXT).
3. **Settings that would change served pages** (this is what G1 catches): SSL mode **Full** (Flexible loops against GitHub Pages' HTTPS redirect); turn **off** Rocket Loader, Email Address Obfuscation, Auto Minify and Web Analytics auto-injection; leave Caching at default.
4. **R2:** create bucket `strata-video` (no public access: the Worker is the only reader), and an API token scoped to it.
5. **Worker:** `cd infra/cloudflare && npx wrangler deploy`. The route is `strataeditor.dev/video/*` only.
6. **Switch nameservers** at GoDaddy to the two Cloudflare gives you. Wait for it to go active. GitHub Pages' certificate for the custom domain keeps working behind the proxy.
7. **After.** Run the G1 compare. **Any `CHANGED` or `LOST` line means undo the nameserver change.** (A pure proxy changes only the `via` column; an edited HTML body shows as a body difference.)
8. **Renders repo:** copy `infra/renders-repo/sync-render.yml` to `.github/workflows/` and `sync.sh` to `.github/sync.sh`; add the secrets named at the top of the workflow.
9. **First publish:** render and publish a short. Then `node tools/verify-publication.mjs <canonical address>`: all locations `verified` is G5 (and G7 once the archive job has run and `archive` is on).
10. **Go live:** set `canonicalLive: true` (and `archive: true` when uploaded) in `releases.js`.
