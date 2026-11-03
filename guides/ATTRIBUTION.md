# Attribution: making authorship computable

The editor has **one history shared by three drivers**: the GUI, the Shell, and an agent working through either. That was built so that a person can take over mid-stream, look at what an agent did and undo it in the same undo stack. It also turns authorship from an assertion about intent into a property of a record. The paper's §2.1 makes the claim that the model supplies speed while the human retains authorship as a design argument and says it has not measured it. This is the instrument for measuring it.

**What is built:** the operation log (who drove each operation, and what it wrote), the attribution engine (whose decisions are present in the finished work), two tools, and a measurement on the diorama. **What is not:** a study with people, any UI, and the blind test itself (see [Keeping the blind test possible](#keeping-the-blind-test-possible)).

| | |
|---|---|
| [`export/oplog.js`](../docs/editor/js/export/oplog.js) | the log: drivers, actors, what a command wrote. Pure, no DOM. |
| [`export/oplogStore.js`](../docs/editor/js/export/oplogStore.js) | where the log is kept between page loads (localStorage, apart from the scene) and who the tab says is driving |
| [`export/attribution.js`](../docs/editor/js/export/attribution.js) | attribution by survival, weighting, categories. Pure. |
| [`tools/attribution.mjs`](../tools/attribution.mjs) | `node tools/attribution.mjs scene.oplog.json scene.state.json` |
| [`tools/session-stats.mjs`](../tools/session-stats.mjs) | the model side of the loop: duration, model calls, retries, from a Copilot CLI session log |
| [`ops/attribution/`](../ops/attribution) | the diorama measurement: the log, the state, the attribution, the session numbers |

## What an operation records

```json
{ "seq": 2, "cid": 1, "verb": "do", "op": "AddObjectCommand", "label": "Add Object: LittlestTokyo.glb",
  "driver": "agent", "channel": "gui", "actor": { "id": "copilot-cli:session-ac65015e", "kind": "agent" }, "declared": true,
  "origin": { "kind": "import", "file": "LittlestTokyo.glb" }, "t": "2026-11-03T14:40:46.628Z",
  "touched": { "objects": 215, "triangles": 141802, "seconds": 0 },
  "w": [ ["92e69143-…", "exists", true], ["92e69143-…", "name", "LittlestTokyo.glb"], … ] }
```

(The first operation of the diorama re-run, as stored. Its channel is `gui` because the harness called the editor's loader directly, not through the Shell; its driver is `agent` because the actor said so. An operation made by a Shell line also carries `"channel": "shell"` and `"exec": N`.)

| Field | Meaning |
|---|---|
| `driver` | `gui`, `shell` or `agent`. **`agent` whenever the actor is an agent**, whatever the channel: an agent typing into the Shell is still the agent. |
| `channel` | where the operation entered: `gui` or `shell`. **Observed**, not declared. The Shell is the editor's one execution surface for typed and generated code. |
| `actor` | `{ id, kind: user \| agent }`. **Declared** by whoever drives: `setActor('copilot-cli:run-7', 'agent')` in the Shell, or `editor.setActor(…)`. It is not authenticated, and an agent that never says it is one is logged as the user (`declared: false` shows which operations were logged on the default). |
| `exec` | the number of the Shell line that made it, so a pass can be read as one thing ("the rig pass") |
| `origin` | `import`: what a file brought (its names, its hierarchy) is the file's, not a decision of whoever imported it |
| `w` | the writes: `[object uuid, property, value]`. The properties are `exists`, `name`, `label`, `parent`, `class:<name>`, `position`, `rotation`, `scale`, `visible`, `material`, `geometry`, `attr:<name>`, `material.<name>` and `timeline:<track>#<event>`. A transform, `visible` or a material is recorded only when it is not the default value or something wrote it later: **a default is not a decision**. |

Undo and redo are operations too (`verb: undo | redo`, carrying the `cid` of the entry they acted on, and the driver who did it). `reset` (File, New), `barrier` (the history was cleared: what is in the scene stays, but can no longer be undone), `load` and `exec` are markers.

The log lives in localStorage under `strata/oplog`, **not in the scene and not in the autosave**, and survives a reload (the history does not, and agent-driven sessions are the ones that reload under you). The actor lives in sessionStorage. `saveAttribution('name')` in the Shell downloads `name.oplog.json` and `name.state.json`; in code, `editor.attributionArtifacts()`.

## Attribution by survival

Not who made more edits: **whose decisions are present in the finished work.**

1. **Replay the undo stack.** Which operations are live at the end? An undone operation, one discarded when a new operation followed an undo, and anything before a File, New contributes nothing.
2. **For every property of the final state**, take the chain of live operations that wrote it. The **last** writer owns it; the **first** originated it. Both are recorded.
3. **Check the log against the state.** If the last logged value is not the value the property has, something changed it outside the history, and the property is `unlogged`: credited to no one.
4. **Weight by consequence.** An operation that assigns 2,841 components to regions is not equal to one that renames a part.

### Categories

| Category | Meaning |
|---|---|
| `agent-authored` | the first and the last live writer are the agent (a person may have touched it in between: `interleaved` says so) |
| `human-authored` | the first and the last live writer are a person; no agent write survives |
| `agent-originated-human-refined` | the agent wrote it first and a person wrote it last: **last-writer-wins would call this human, and it is not quite**. Both operations are in the record. |
| `human-originated-agent-refined` | the reverse. The work order has three categories; this is the fourth case it does not name, kept apart rather than forced into either. |
| `source` | an import wrote it and nobody has since: the file's, not a decision |
| `baseline` | nothing in this log wrote it: it was in the scene when the log began |
| `unlogged` | the log's value is not the final value: changed outside the history, and credited to no one |

### Weights

Each object's **triangles** are shared equally among its properties, so the categories add to the model. A timeline event weighs its **seconds**. The **headline is the triangle-weighted share**; the object-weighted and property-count shares are reported beside it, because unweighted counts flatter whoever made the most small operations. The per-operation `touched` (objects, triangles, seconds) is recorded at the time, and the per-operation table says how much of each operation survived.

### The rig pass: the case where a count is wrong in both directions

On the diorama the first rig pass tagged 143 nodes `rig` **and** wrongly tagged the nine SEG groups, which was then corrected. A count of operations calls that 162 agent operations (153 tags and 9 removals), every one of them live. By survival, `--exec` reads the pass:

```
$ node tools/attribution.mjs ops/attribution/diorama-rerun.oplog.json ops/attribution/diorama-rerun.state.json --exec 13
exec 13 (agent, copilot-cli:session-ac65015e): (() => { const root = scene.getObjectByName('LittlestTokyo.glb'); …
  154 operations, 205 writes: 196 survived, 9 overwritten, 0 undone
  class:model   survived 1
  class:rig     survived 143, overwritten 9
  name          survived 52
```

143 survive, 9 do not. The nine are *overwritten*, not undone: the correction was a second set of operations, so every operation is live and a measure that only discounts undone operations would still count them.

## What it found on the diorama

**The first run of the instrument found a hole in the log, and the hole is the point.** The 114 properties it could not account for were all `name`: the 62 renames and the 52 `Rig_Node_N` names were set by **direct assignment** in Shell code (`o.name = …`), which never goes through a command and is in no history. The central claim of the diorama ("an agent named 186 objects") would have been mostly unattributable. The fix needed no change to how anything executes: the Shell is the one execution surface, so around each Shell line the editor compares the properties it measures, before and after, and records what changed and was **not explained by a command** as a *witnessed* write, attributed to whoever drove the line and never undoable (the history never held it).

### The measurement

> **This is a re-run, not the original session.** The original session's history was never logged (there was no driver field, the history is in memory, and the page reloaded under it), so its operations cannot be recovered. What is measured is the same procedure run again through the instrumented editor with the same scripts, in the same order: the import and the nine cuts, the 62 renames, the first (buggy) rig pass, the correction. One difference: the correction as originally run selected on the derived classes, which a never-reloaded session has not indexed, so it is keyed on the stored classes here. The logs are in [`ops/attribution/`](../ops/attribution).

| | |
|---|---|
| Operations | 340 live, 0 undone; 2 witnessed (114 writes) |
| Final state | 339 objects, 141,802 triangles, 2,224 properties |
| Unlogged / baseline / opaque | 0 / 0 / 0 |
| Actors | one, `copilot-cli:session-ac65015e` (agent). Drivers seen: `agent` only. |

| Category | triangles (headline) | objects | properties |
|---|---|---|---|
| agent-authored | **77.8%** | 59.9% | 63.8% |
| source (the file's own) | 22.2% | 40.1% | 36.2% |
| human-authored, agent-originated-human-refined, … | 0 | 0 | 0 |

**This is the degenerate case, as expected.** No person intervened, so the answer is 100% agent among what was authored, by construction, and the condition the paper is about, a person taking over, was never exercised. The tool says so in its output rather than presenting it as a finding. The instrument is exercised on mixed logs in the tests (`attribution.test.mjs`, `tools/__tests__/attribution.test.mjs`), which build logs where a person corrects one agent name, undoes an agent operation and rewrites a witnessed rename: those are fixtures, not measurements.

### Operational numbers

From the original session's log, by [`tools/session-stats.mjs`](../tools/session-stats.mjs) ([`diorama-session.stats.json`](../ops/attribution/diorama-session.stats.json)). Nobody has run this loop at this scale; this is the figure that says whether a few hundred assets is an afternoon or a month.

| | segmentation (request → "save it") | save and commit | tutorial |
|---|---|---|---|
| Wall clock | **2 h 57 min** | 22 min | 43 min |
| Active (gaps over 5 min left out) | 1 h 52 min | 15 min | 31 min |
| Model calls | **135** | 27 | 53 |
| Model busy | 23 min | 4 min | 13 min |
| Tool calls | 151 | 27 | 61 |
| …that reached the editor | 45 (43 driver scripts) | 6 | 0 |
| Retries (heuristic) | 3 failed calls + 4 outputs showing a reload or crash | 1 | 0 |
| Messages from the person | **1** | 3 | 1 |

Read these as: **~3 hours and ~135 model calls for 186 named objects, with one human message**, so roughly 1 minute and 0.7 calls per object, nearly all of it the agent working out a method for a mesh the existing method could not handle. A model call is one usage record; "tokens in" (60.7 M for the segmentation) counts the whole context re-sent with each call and is mostly cache, so it measures the context, not the work. **Retries are a heuristic, not a count the log states**: it counts only what a tool result shows (a failed call, an output saying the page was reloaded or crashed). The page reloaded itself repeatedly and the driver retried inside its scripts without surfacing it, so it undercounts those, and it can count a reload message that did not cost a retry. The re-run itself took about 7 minutes of machine time, which is the floor for this procedure once the method is known, and the gap between that and 3 hours is the cost of finding the method.

## Keeping the blind test possible

The second check, whether authorship is *legible* and not merely recorded, needs the artifact shown **without** its history, so that someone can attribute cold and be scored against the log: the recovery measurement's shape (hide the structure, test whether it can be recovered, score against a key that existed first). High accuracy means authorship is readable from the work; chance accuracy means the information is stored and reaches nobody, a real result and a different one from "the record contains it."

What this does to keep it possible: **the record is a separate artifact from the scene**. The scene has no `oplog`, `driver`, `actor` or attribution anywhere, and the editor's `toJSON` does not embed the log (it is not in the undo history the scene serialises either: the history holds commands, and commands carry no driver). `--scene scene.json` checks it:

```
$ node tools/attribution.mjs LOG STATE --scene scene.json
the scene file carries no attribution: the record is separable        (exit 1 and a list of the keys if it does)
```

Not built: the blind condition itself, the participants, the scoring.

## Where this stops

* **The actor is self-reported.** An agent that does not call `setActor` is logged as the user, and nothing here can tell. The `declared` flag shows which operations were logged on the default. For a contributor session (the STOA verification loop) the id should be the authenticated one, as `--by @name` is for reviews (`MESH_SEGMENT.md`, "Verification"); that binding is not built.
* **A Shell line that is still running owns the editor.** The Shell context is held until a returned promise settles, so a person acting in the GUI while an agent's long Shell line is pending is logged as the Shell's, and a witnessed change in that window goes to the line's driver. Rare in practice, and the reason the window is recorded (`exec`).
* **Witnessing sees only Shell lines.** A direct change from anywhere else (a script outside the Shell, the browser console, a page script) is still `unlogged`, which is why that category exists and why the figure is reported. The witness compares name, parent, transform, visibility, label, material and classes; it does not see geometry edits, material parameters or the timeline made directly.
* **Imports are marked only for glTF.** Other formats arrive as the importing driver's operation, with the file's names counted as theirs.
* **A command the module does not know is `opaque`**: kept, counted in the coverage figure (0 on the diorama), and not attributed per property.
* **Triangles weight objects, not meaning.** An object's triangles are shared equally among its properties, which treats a name and a transform as equal. A different split is a different headline; this one is stated so it can be argued with.
* **The log is bounded by localStorage** (8 MB; a larger stored log starts a new one with a `gap` marker). A diorama is about 300 KB.
* **Timeline work is measured but untested on a real session**: the seconds weighting is covered by tests, not by a measurement.

## Gates

| | | |
|---|---|---|
| **A1** | Every operation carries a driver and an actor | `validateOpLog` and `--validate`; the history hooks record every execute, undo and redo; the diorama log validates |
| **A2** | Last writer over the final state; undone and overwritten score zero | `liveEntries` replays the stack; tested for undo, redo, discard, barrier and reset |
| **A3** | The rig-pass case: 143 survive, 9 do not | real operations, above; also a fixture of the same shape |
| **A4** | Weighted and unweighted reported, weighted the headline | triangles are the headline; objects, seconds and counts beside it |
| **A5** | Three categories, with the originating and the last-modifying operation | plus the fourth case, kept apart; both operations in every chain |
| **A6** | The record is a separate artifact from the scene | `--scene` check; no key in the scene |
| **A7** | Diorama operational numbers recorded | above, and [`diorama-session.stats.json`](../ops/attribution/diorama-session.stats.json) |

**Checked:** 25 + 7 + 4 tests in node; the hooks in the real editor in Chrome with software rendering (a declared agent, Shell passes numbered, a person's undo of an agent operation, a direct assignment flagged, the log surviving a reload); the diorama procedure end to end. **Not checked:** any browser but Chrome; a session with a real person in it; the timeline in a live session; the in-editor AI's operations (its code path is read-only in this build, and its eval harness is marked `agent` but was not run).
