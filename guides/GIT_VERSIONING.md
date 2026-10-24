# Git integration (versioning)

> Part of the [Strata documentation](../README.md#documentation). See also:
> [Architecture](ARCHITECTURE.md) · [The language](LANGUAGE.md) · [AI guide](AI_GUIDE.md)

Open the **Git** menu to configure a repository and sync scenes. All calls use `fetch()` directly. No Octokit.

| Action | Behaviour |
|--------|-----------|
| **Settings** | Repo URL, branch, an optional pinned commit/tag (empty = "latest", i.e. track the branch), scene-file path, access token (see below). |
| **Load Scene** | Clears the scene and loads the repo's scene file. Unsaved local work is held for recovery first (see [Unsaved work](#unsaved-work-is-never-silently-lost)). |
| **Compare with Remote** | Opens the merge-conflict viewport (below). |
| **Commit Scene** | The AI writes a diff-aware message (added/removed/modified vs last commit). Editable before commit. |
| **Auto-load on open** | If a repo is configured, the scene loads from GitHub on page open (after local autosave, so GitHub wins). **File, New** suppresses this once. Unsaved local work is never overwritten silently: it is offered back after the load. |

Reads (Load Scene, Compare with Remote, and the URL hash preload below) go through a CDN-first resolver, not the GitHub REST API: raw.githubusercontent.com and jsDelivr are tried first (raw first when authoring, for freshness; jsDelivr first in present/preview mode, for scale), and the API is used only as a last-resort fallback if both CDN edges fail. This sidesteps GitHub's 60 req/hr anonymous rate limit — the failure mode that used to hit shared-IP classrooms and widely-shared links hardest. It handles files over 1 MB and decodes UTF-8 natively. Commits (writes) always go through the GitHub API with a token, exactly as before — there is no CDN write path.

## How a scene is written

**Commit Scene** writes the scene as **compact JSON** — one line, never pretty-printed — with big geometry buffers and images split out as binary assets. A scene is megabytes of baked float arrays, and large scenes are split into `$chunked` parts on byte boundaries anyway, so line diffs were never usable; indentation was pure size. For a human-readable dump, export a readable copy explicitly; it is never the committed artifact.

Animation values are also **quantized** on save (`docs/editor/js/SceneQuantize.js` — lossy, deterministic, same scene in → byte-identical file out):

| Data | Precision |
|------|-----------|
| Quaternion tracks | 5 decimals |
| Position tracks | 4 decimals (0.1 mm at metre scale) |
| Key times | 4 decimals (0.1 ms) |

Nothing structural is quantized (uuids, indices, matrices, geometry, scale/rotation/morph tracks, the timeline model). On a 170-second two-performer capture, measured on the live scene: pretty-printed 349.9 MB → compact 107.0 MB (−69%) → compact + quantized 84.4 MB (−76% in total).

Minifying does not change how a scene is *loaded*: the chunked reader still reassembles every part before parsing. When a load fails, the banner names the stage that failed (fetching the scene, fetching assets, applying the scene) and the console carries the stack.

## Unsaved work is never silently lost

Edits (made in the UI, the JS shell, the timeline, or by importing) are autosaved to the browser (IndexedDB, database `strata-work`) about a second after you stop, **keyed by where the scene came from**: repo + file + branch (+ commit pin), or one default key when no repo is set. The autosave holds everything `editor.toJSON()` round-trips, including the universal timeline and clips. Derived data is never persisted: call-card baked textures are stripped (`withoutBakedTextures` in `scene/serialize.js`, used by autosave, Save and Commit alike), and lazily derived object descriptors are ignored when deciding what changed.

**Dirty indicator.** The editor keeps a cheap hash of the serialised scene (camera, orbit controls and undo history excluded; computed after the same debounce, never per frame) and compares it with the snapshot of the last load or commit. When they differ, an **Uncommitted changes** chip appears in the menubar and the tab title gets a `●` prefix. Undoing back to the clean snapshot clears it. **Commit**, **File, Save** and **File, New** mark the scene clean.

**One-step commit.** Click the chip. The popover shows when the work was last autosaved and, if a repo and token are set, a message field and a **Commit** button that runs the normal commit flow (no new auth). Without a repo or token it offers **Open Git tab** instead.

**Recovering after a load.** Reloading the page, opening a `#repo=…` link, **Load Scene** and the boot auto-load all replace the scene with the repo's. If a dirty autosave exists for the same source (or the scene on screen was dirty), it is first moved to a held slot, the repo's scene loads, and a non-blocking prompt asks **Recover unsaved changes from 5 minutes ago?**

- **Recover** puts your edits back; they read as unsaved, so you can commit them.
- **Discard** deletes the held copy.
- **Later** hides the prompt and keeps the copy for the next load.

A held copy only disappears through an explicit Discard, or when it is identical to what just loaded. An autosave that is already clean, or already committed, is not offered. A second tab editing the same source cannot overwrite your unsaved autosave either: it is held the same way.

**Leaving the page.** The browser's leave-page warning appears only while the scene is dirty.

**JS shell.** Code run in the shell can change the scene without any editor signal, so the shell tells the guard after every run (`editor.work.touch()`) and such edits are picked up too.

Code: `workState.js` (hash, dirty state machine, recover decision, wording; node tests in `__tests__/workState.test.mjs`), `WorkStore.js` (IndexedDB), `WorkGuard.js` (editor wiring), `Menubar.Work.js` (chip, popover, prompt).

## Merge-conflict viewport

`Git, Compare with Remote` diffs your scene against the repo's. It opens a split-screen review: left is local, right is remote, one shared orbit camera. Objects are tinted green (added), red (removed), orange (modified). A per-conflict list lets you choose local, remote, or both per object (or **Accept All**). **AI Suggest** proposes resolutions. **Apply Merge** rebuilds the scene from your choices.

> **Token storage and scope.** The access token lives in `localStorage` (`git-settings`). Same-origin scripts can read it, so treat it like a password. Prefer a fine-grained, repo-specific PAT (Settings, Developer settings, Fine-grained tokens) scoped to the one repo with **Contents: Read and write** only. A classic `repo`-scope token grants write access to every repository in your account. Avoid it here.

Scenes are diffable JSON. See [scene representation](ARCHITECTURE.md#scene-representation) for the round-trip guarantees that make git diffs meaningful.

## Shareable links (URL hash preload)

Appending `#repo=<owner>/<repo>&file=<path>` to the app URL loads that scene from a repo automatically on page open — before local autosave or the configured `git-settings` repo, so it always wins when present. An optional `&branch=<name>` selects a non-`main` branch, and an optional `@<ref>` suffix directly on `repo=` picks a branch, tag, or commit SHA inline (`&branch=` wins over it if both are given). An optional `&commit=<sha|tag>` pins to an EXACT commit/tag and wins over both — the most specific override always takes priority; with none of the three given, `main` is tried then `master`.

```
https://your-strata-host/#repo=tejaswigowda/test1&file=scene.json
https://your-strata-host/#repo=tejaswigowda/test1&file=scene.json&branch=dev
https://your-strata-host/#repo=tejaswigowda/test1@abc123&file=scene.json
https://your-strata-host/#repo=tejaswigowda/test1&file=scene.json&commit=abc123
```

- **No token required to read a public repo, and no GitHub API call in the common path.** The hash loader resolves the scene and its assets through CDN edges (jsDelivr, raw.githubusercontent.com) — never the GitHub API — so this link can be shared widely, embedded, or opened from a shared classroom IP without tripping GitHub's 60 req/hr anonymous rate limit. `&present=true` (or its alias `&preview=true`) prefers jsDelivr first (built for scale); otherwise raw.githubusercontent.com is tried first (built for freshness). The GitHub API is only ever used as a last-resort fallback if both CDN edges fail (e.g. a very fresh push jsDelivr hasn't picked up yet, or a CDN outage); a token already saved in the Git tab is reused opportunistically for that fallback (e.g. to read a private repo) but is never required just to view a public one. Committing back still requires a token, entered in the Git tab as usual.
- The Git tab's Repo/Branch/Commit/Path fields update to reflect the loaded scene (without touching a saved token), so **Compare with Remote** and **Commit** immediately target the same place. A `&commit=` pin populates its own Commit field rather than overwriting Branch — pinning to a past commit doesn't change what branch a later manual commit targets.
- **The hash and the Git tab stay in sync, both ways.** Loading or committing a scene from the Git tab rewrites the URL hash to `#repo=…&file=…&branch=…[&commit=…]` (via `history.replaceState`, so it adds no history entry and triggers no reload; `play`, `present` and `preview` are preserved). Editing the hash by hand, or using back/forward, loads that scene and updates the Git tab fields. Hashes without `repo=` are ignored, and a hash the app wrote itself is never re-loaded. **File → New** clears the hash and resets the Git tab's Scene file (to `scene.json`) and Commit pin, keeping Repository, Branch and token — so a reload stays empty and a first commit of the new scene can't overwrite the file that was loaded.
- **Share URL.** The Git tab shows a read-only **Share URL** field with a copy-to-clipboard button. It is the app URL plus `#repo=…&file=…&branch=…[&commit=…]` for the current settings, updating live as you edit the fields.
- A missing hash, an unparseable `repo=` value, or any load failure is logged to the console only — it never throws or shows a blocking dialog — and the editor falls through to its normal boot sequence (local autosave, then the configured-repo auto-load) unchanged. Failures are classified (not found / rate-limited / network / invalid JSON) so the banner shown reports the real reason instead of always assuming a rate limit.

---

**Next:** [Architecture](ARCHITECTURE.md) · [← Back to README](../README.md)
