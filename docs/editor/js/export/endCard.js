// ── endCard.js ───────────────────────────────────────────────────────────────────────────────────
// The end card is a live web page, rasterised at render time. That makes it an input that is not pinned: it can change between renders, and it did (the baked
// texture itself differed between the first render after a page load and the next). So the render bakes it once, at its start, and the image is recorded as an
// input exactly like the scene and the narration WAV: a PNG beside the render (endcard.png) with its own sha256, and render.json says what it was built from
// and what the page said at the time (its version stamp), so a reader can see why a later render differs.

/** The bytes of the baked card as a PNG, with its sha256: { bytes, sha256, url, stamp, width, height }. `baked` is what refreshCallcard resolved. */
export async function recordEndCard( baked ) {

	if ( ! baked || ! baked.canvas ) return null;
	const blob = await new Promise( resolve => baked.canvas.toBlob( resolve, 'image/png' ) );
	if ( ! blob ) return null;
	const bytes = new Uint8Array( await blob.arrayBuffer() );
	const digest = await crypto.subtle.digest( 'SHA-256', bytes );
	return {
		bytes, sha256: Array.from( new Uint8Array( digest ), b => b.toString( 16 ).padStart( 2, '0' ) ).join( '' ),
		url: baked.url || null, stamp: baked.stamp || null, width: baked.width, height: baked.height,
	};

}
