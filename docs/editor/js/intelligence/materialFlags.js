// ── materialFlags.js ───────────────────────────────────────────────────────────
// three.js bakes `transparent === false` into a material's shader program (#define OPAQUE: the fragment's alpha is forced
// to 1) and picks the program again only when `material.version` changes. Flipping `transparent` alone therefore leaves a
// material that was first drawn opaque ignoring its opacity for the rest of that renderer's life, which made what an offline
// render drew depend on WHEN each material was first drawn: a full render and a render of part of it disagreed, and so did
// the first render of a freshly loaded scene and the next. Every flip made while a scene is being sampled goes through here.

/** Set `material.transparent`; when it actually changes, make three.js select the program again (programs are cached, and flips are rare). */
export function setTransparent( material, transparent ) {

	if ( material.transparent === transparent ) return;
	material.transparent = transparent;
	material.needsUpdate = true;

}
