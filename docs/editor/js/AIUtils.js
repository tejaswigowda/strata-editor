// ── Scene summariser ──────────────────────────────────────────────────────────
// Produces a compact (~1–2 KB) JSON snapshot of the current scene state that
// is injected into every AI request as context.

export function summarizeScene( editor ) {

	const scene    = editor.scene;
	const camera   = editor.camera;
	const selected = editor.selected;

	const objects = [];

	scene.traverse( function ( obj ) {

		if ( obj === scene ) return;

		const item = {
			uuid: obj.uuid.slice( 0, 8 ),
			name: obj.name || '(unnamed)',
			type: obj.type,
			pos:  obj.position.toArray().map( v => +v.toFixed( 2 ) ),
		};

		if ( obj.isMesh && obj.material && obj.material.color ) {

			item.color = '#' + obj.material.color.getHexString();

		}

		objects.push( item );

	} );

	const truncated = objects.length > 40;

	return {
		objectCount: objects.length,
		objects:     objects.slice( 0, 40 ),
		...( truncated ? { truncated: true } : {} ),
		selected: selected ? {
			uuid: selected.uuid.slice( 0, 8 ),
			name: selected.name,
			type: selected.type,
			pos:  selected.position.toArray().map( v => +v.toFixed( 2 ) ),
		} : null,
		camera: {
			pos: camera.position.toArray().map( v => +v.toFixed( 2 ) ),
		},
	};

}

// ── Code extractor ────────────────────────────────────────────────────────────
// Pulls the first ```js / ```javascript fenced block, or falls back to the
// full trimmed text when the model outputs raw code without fences.

export function extractCode( text ) {

	const fenced = text.match( /```(?:javascript|js)?\n?([\s\S]*?)```/ );
	if ( fenced ) return fenced[ 1 ].trim();
	return text.trim();

}

// ── Message builder ───────────────────────────────────────────────────────────
// Constructs the messages array for a single inference call.
// sceneCtx is the object returned by summarizeScene().

export function buildMessages( systemPrompt, sceneCtx, userPrompt ) {

	let ctxStr;

	try {

		ctxStr = JSON.stringify( sceneCtx );

		// Trim to ≤1 500 chars to save tokens on small models
		if ( ctxStr.length > 1500 ) {

			const compact = { ...sceneCtx, objects: sceneCtx.objects.slice( 0, 15 ), truncated: true };
			ctxStr = JSON.stringify( compact );

		}

	} catch {

		ctxStr = '{}';

	}

	return [
		{ role: 'system', content: systemPrompt },
		{ role: 'user',   content: 'Scene: ' + ctxStr + '\n\nRequest: ' + userPrompt },
	];

}
