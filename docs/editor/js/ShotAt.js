// ── ShotAt.js ─────────────────────────────────────────────────────────────────
// Which camera is "on" at a given time. Pure helpers for the play bar's shot chip: the Render tab's
// camera sequence (scene.userData.renderShots, each { at, camera: uuid }) picks the shot at the
// playhead exactly like the renderer does (the last shot whose `at` is <= t); with no usable shots
// the chip falls back to the active / followed viewport camera.

/** The shot active at time `t`, or null when there are no shots. Does not mutate `shots`. */
export function shotAt( shots, t ) {

	if ( ! Array.isArray( shots ) || shots.length === 0 ) return null;

	const sorted = shots.filter( s => s && typeof s.at === 'number' ).sort( ( a, b ) => a.at - b.at );
	if ( sorted.length === 0 ) return null;

	let current = sorted[ 0 ];
	for ( const shot of sorted ) {

		if ( shot.at <= t ) current = shot; else break;

	}

	return current;

}

/**
 * Name for the play bar's chip. `cameras` is editor.cameras (uuid -> camera), `fallback` the camera
 * to name when no shot applies. Returns '' when nothing has a name.
 */
export function shotCameraName( shots, t, cameras, fallback ) {

	const shot = shotAt( shots, t );
	const camera = shot && cameras ? cameras[ shot.camera ] : null;
	const named = camera || fallback;
	if ( ! named ) return '';

	return named.name && String( named.name ).trim() ? String( named.name ).trim() : 'Camera';

}
