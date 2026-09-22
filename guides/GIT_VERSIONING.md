# Git integration (versioning)

> Part of the [Strata documentation](../README.md#documentation). See also:
> [Architecture](ARCHITECTURE.md) · [The language](LANGUAGE.md) · [AI guide](AI_GUIDE.md)

Open the **Git** menu to configure a repository and sync scenes. All calls use `fetch()` directly. No Octokit.

| Action | Behaviour |
|--------|-----------|
| **Settings** | Repo URL, branch, an optional pinned commit/tag (empty = "latest", i.e. track the branch), scene-file path, access token (see below). |
| **Load Scene** | Clears the scene and loads the repo's scene file. |
| **Compare with Remote** | Opens the merge-conflict viewport (below). |
| **Commit Scene** | The AI writes a diff-aware message (added/removed/modified vs last commit). Editable before commit. |
| **Auto-load on open** | If a repo is configured, the scene loads from GitHub on page open (after local autosave, so GitHub wins). **File, New** suppresses this once. |

Reads (Load Scene, Compare with Remote, and the URL hash preload below) go through a CDN-first resolver, not the GitHub REST API: raw.githubusercontent.com and jsDelivr are tried first (raw first when authoring, for freshness; jsDelivr first in present/preview mode, for scale), and the API is used only as a last-resort fallback if both CDN edges fail. This sidesteps GitHub's 60 req/hr anonymous rate limit — the failure mode that used to hit shared-IP classrooms and widely-shared links hardest. It handles files over 1 MB and decodes UTF-8 natively. Commits (writes) always go through the GitHub API with a token, exactly as before — there is no CDN write path.

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
- A missing hash, an unparseable `repo=` value, or any load failure is logged to the console only — it never throws or shows a blocking dialog — and the editor falls through to its normal boot sequence (local autosave, then the configured-repo auto-load) unchanged. Failures are classified (not found / rate-limited / network / invalid JSON) so the banner shown reports the real reason instead of always assuming a rate limit.

---

**Next:** [Architecture](ARCHITECTURE.md) · [← Back to README](../README.md)
