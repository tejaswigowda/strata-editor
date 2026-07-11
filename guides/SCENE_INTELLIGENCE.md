# Scene intelligence

> Part of the [Strata documentation](../README.md#documentation). See also:
> [The language](LANGUAGE.md) · [JS Shell](JS_SHELL.md) · [AI guide](AI_GUIDE.md)

Resolves natural-language part references against imported GLBs whose nodes are named `Object_12, Object_44`. It uses only deterministic math, the existing renderer, and the already-loaded code LLM. No new model download.

**Per-node descriptors** (`userData.descriptors`, derived on import):
- **Region.** left/right/top/bottom/front/back within the parent bounding box.
- **Shape.** elongated / flat / blocky / thin (from sorted bbox dims: limb vs panel vs block).
- **Symmetry pairs.** Reflect a sibling's centroid across the parent plane. Matches tag left/right. This is the high-value primitive for arms, legs, and wheels.
- **Color.** Sampled from the texture (16x16 offscreen render, dominant HSV bin, color name). `baseColorFactor` is usually white on real GLBs. Pure pixel math, reuses the renderer.
- Size rank, orientation, adjacency, hierarchy role.

**Resolution is cheap-first.** A deterministic rule match (free, offline) handles most queries. Ambiguous ones build a compact descriptor table and ask the loaded LLM to disambiguate. Never silently wrong: it returns confidence and ranked candidates, and detects single merged-mesh GLBs (no per-part nodes) and says so.

The AI scene context is enriched with compact `desc(region,shape,color,pair)` tags. The code-gen model maps "right arm of the red person" to a node by reasoning, with zero extra inference.

```js
findByDescription('the right arm of the red person')  // node (or null)
describeObject(obj)        // {region, shape, color, sizeRank, pair, ...}
listCandidates('the two wheels at the back')          // ranked candidates
resolvePartAI('the flat panel on top')                // async: rule match + LLM disambiguation
```

Descriptors also feed the **auto-class** vocabulary the [selector language](LANGUAGE.md#selector-grammar) matches against — facts like `.front .left .red .elongated .pair-left` become addressable classes with no labeling step.

---

**Next:** [The language](LANGUAGE.md) · [AI guide](AI_GUIDE.md) · [← Back to README](../README.md)
