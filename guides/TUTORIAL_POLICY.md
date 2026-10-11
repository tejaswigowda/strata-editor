# Tutorial & demo publication policy

> Part of the [Strata documentation](../README.md#documentation). See also: [Roadmap](ROADMAP.md) · [Character customizer](CUSTOMIZER.md)

**The principle: name and frame every public artifact after the *capability*, never the character.**
Strata's capability (text → look, retargeting one motion onto two rigs, self-documenting tutorials) is
clean. The risk is only in the *public framing* reaching for owned characters. Famous or owned targets
are fine as **private** capability tests; everything on the live site uses an **original, archetype, or
public-domain** target.

## The rules

1. **Named or registered IP** — character names, franchise names, trademarks — must not appear in a
   public **title, URL/slug, heading, or image alt text** (and the same goes for captions, the
   `tutorials.json` manifest and screenshot file names). A lowercase common word used descriptively
   ("a construct, if you like") is fine; a titled proper-noun location ("the Construct") is not.
2. **Likeness is not just the name.** A character is protected by its *design*. Removing the label is
   not enough if the look still unmistakably reproduces the character: shift the signature elements
   (hair, gear, palette, silhouette), or frame the result openly as a generic archetype.
3. **Base-asset licenses stay honest.** Keep the VRoid / Mixamo / metahuman-to-glb terms notes on the
   pages that use them. The VRoid base's free / commercial / redistribute terms are fine and stay.
4. **Title = capability.** "One dance, two characters", "Restyle a VRM into an explorer with the JS
   Shell" — never "Make X into &lt;famous character&gt;".

## Target kinds

| `targetKind` | Public? | Example |
|---|---|---|
| `original` | yes | an invented character, or a stock rig left un-restyled (Bruce, The Boss) |
| `archetype` | yes | "expedition explorer", "knight", "astronaut" — generic roles, no signature design |
| `public-domain` | yes | Sherlock Holmes (original stories), Dracula, Alice (Carroll text), classical figures |
| `named-ip` | **no — private lane only** | any character or franchise someone owns |

**Private lane:** a named-IP run is allowed as an internal capability test or benchmark. It is not
published to the live site and **not committed to a public repository** (scene files included — a
scene is a public artifact once its repo is public).

## The gate (for the generator)

The Playwright auto-tutorial generator writes these pages, so the policy has to live where the pages are
written, not just in two hand edits. [`scripts/tutorial-policy.cjs`](../scripts/tutorial-policy.cjs) is
that gate. Call it before anything is written under `docs/about/tutorials/`:

```js
const policy = require( './scripts/tutorial-policy.cjs' );
const plan = policy.planPublication( {
	capability: 'Restyle a VRM into an explorer with the JS Shell',
	headings, alts, captions,          // everything the page will display
	targetKind: 'archetype',           // original | archetype | public-domain | named-ip
	targetName: 'expedition explorer', // what the run actually built
} );
if ( plan.path !== 'public' ) writeToPrivateLane( run, plan.reasons );   // never docs/
else writePublicPage( plan.slug, plan.title, run );                      // capability-framed, name-free
```

* A `named-ip` run returns `path: 'private'`. A run with an original / archetype target and a clean,
  capability-framed title returns `path: 'public'` plus a derived slug.
* A denylist of obvious franchise / character / trademark terms is the backstop (it also refuses a
  clean title on a named-IP target). It cannot see *likeness*; the generator must choose an original or
  archetype target in the first place.
* `node scripts/tutorial-policy.cjs lint` re-checks every shipped page (title, meta description,
  headings, alt text, captions, image paths, link targets, body text, file and screenshot names,
  `tutorials.json`) and the redirect map. `node scripts/tutorial-policy.cjs selftest` runs one
  named-IP and one archetype run through the gate. Run both before committing tutorial changes.

### Prompt fragment for the authoring step

> Title and slug the tutorial after the **capability it teaches**, never after a character or franchise.
> Do not emit any named or registered character, franchise, or trademark in the title, URL slug,
> headings, image alt text or captions. The target must be an original character, a generic archetype,
> or a public-domain figure; if the requested target is owned by someone, stop and produce a private
> artifact instead. Even with a clean name, do not reproduce a protected character's signature design
> — change the hair, gear and palette, or describe the result as a generic archetype.

## Renaming a published tutorial

Never leave an inbound link dead. Add the pair to
[`docs/about/tutorials/redirects.json`](../docs/about/tutorials/redirects.json), keep a stub page at the
old slug (a JS redirect that preserves `location.search` and `location.hash`), and add an explicit 301
line to [`docs/_redirects`](../docs/_redirects) for hosts that honour it (Cloudflare Pages, Netlify).
Don't rely on a blanket rule. The linter fails if any of the three is missing. The old slug is exempt
from the name check — it exists only so old links keep working.

---

**Next:** [Roadmap](ROADMAP.md) · [← Back to README](../README.md)
