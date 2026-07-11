# Git integration (versioning)

> Part of the [Strata documentation](../README.md#documentation). See also:
> [Architecture](ARCHITECTURE.md) · [The language](LANGUAGE.md) · [AI guide](AI_GUIDE.md)

Open the **Git** menu to configure a repository and sync scenes. All calls use `fetch()` directly. No Octokit.

| Action | Behaviour |
|--------|-----------|
| **Settings** | Repo URL, branch, scene-file path, access token (see below). |
| **Load Scene** | Clears the scene and loads the repo's scene file. |
| **Compare with Remote** | Opens the merge-conflict viewport (below). |
| **Commit Scene** | The AI writes a diff-aware message (added/removed/modified vs last commit). Editable before commit. |
| **Auto-load on open** | If a repo is configured, the scene loads from GitHub on page open (after local autosave, so GitHub wins). **File, New** suppresses this once. |

Content is fetched with the GitHub raw media type. It handles files over 1 MB and decodes UTF-8 natively. It is cache-busted so a fresh commit is not served stale.

## Merge-conflict viewport

`Git, Compare with Remote` diffs your scene against the repo's. It opens a split-screen review: left is local, right is remote, one shared orbit camera. Objects are tinted green (added), red (removed), orange (modified). A per-conflict list lets you choose local, remote, or both per object (or **Accept All**). **AI Suggest** proposes resolutions. **Apply Merge** rebuilds the scene from your choices.

> **Token storage and scope.** The access token lives in `localStorage` (`git-settings`). Same-origin scripts can read it, so treat it like a password. Prefer a fine-grained, repo-specific PAT (Settings, Developer settings, Fine-grained tokens) scoped to the one repo with **Contents: Read and write** only. A classic `repo`-scope token grants write access to every repository in your account. Avoid it here.

Scenes are diffable JSON — see [scene representation](ARCHITECTURE.md#scene-representation) for the round-trip guarantees that make git diffs meaningful.

---

**Next:** [Architecture](ARCHITECTURE.md) · [← Back to README](../README.md)
