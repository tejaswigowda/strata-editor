// ── renderFileName.js ─────────────────────────────────────────────────────────
// Names the files the Render tab downloads. Pure functions, so the rules are testable.
//
//   pyth_1m40s_1080p_30fps_2026-10-25.mp4
//   pyth_360_1m40s_2048x1024_30fps_2026-10-25.webm
//   pyth_camera_1080p_2026-10-25_1410.png        (snapshot)
//
// The video name is a template the user can edit: {project} {duration} {res} {fps} {date} {time}
// {camera} {360}. Tokens that do not apply collapse away with their separator.

export const DEFAULT_VIDEO_TEMPLATE = '{project}_{360}_{duration}_{res}_{fps}fps_{date}';
export const DEFAULT_SNAPSHOT_TEMPLATE = '{project}_{camera}_{res}_{date}_{time}';

export const TOKENS = [ 'project', 'duration', 'res', 'fps', 'date', 'time', 'camera', '360' ];

/** A file-name-safe version of free text: letters, digits, dot and dash; runs of anything else become one dash. */
export function slug( text ) {

	return String( text == null ? '' : text )
		.normalize( 'NFKD' ).replace( /[\u0300-\u036f]/g, '' )
		.replace( /[^A-Za-z0-9.]+/g, '-' )
		.replace( /-+/g, '-' )
		.replace( /^[-.]+|[-.]+$/g, '' );

}

/** 'pyth.json' → 'pyth'; 'scenes/My Scene.json' → 'My-Scene'; '' → ''. */
export function projectName( fileOrTitle ) {

	const last = String( fileOrTitle || '' ).split( '/' ).pop().replace( /\.(json|glb|gltf)$/i, '' );
	return slug( last );

}

/** 1920×1080 → '1080p'; non-16:9 sizes stay as '1080x1080'. */
export function resolutionLabel( width, height ) {

	if ( [ 2160, 1440, 1080, 720, 480, 360 ].includes( height ) && Math.abs( width / height - 16 / 9 ) < 0.02 ) return height + 'p';
	return `${ width }x${ height }`;

}

/** 100.5 → '1m41s'; 45 → '45s'; 3600 → '1h0m0s'. Rounded up so a clip is never described as shorter than it is. */
export function durationLabel( seconds ) {

	const total = Math.max( 0, Math.ceil( seconds - 1e-9 ) );
	const h = Math.floor( total / 3600 ), m = Math.floor( ( total % 3600 ) / 60 ), s = total % 60;
	if ( h > 0 ) return `${ h }h${ m }m${ s }s`;
	return m > 0 ? `${ m }m${ s }s` : `${ s }s`;

}

const pad = n => String( n ).padStart( 2, '0' );

export function dateLabel( date ) {

	return `${ date.getFullYear() }-${ pad( date.getMonth() + 1 ) }-${ pad( date.getDate() ) }`;

}

export function timeLabel( date ) {

	return pad( date.getHours() ) + pad( date.getMinutes() );

}

/**
 * Fills a template. Unknown {words} are left out, empty values drop their separator, and the result
 * is always a usable name (falls back to `fallback`).
 */
export function fillTemplate( template, values, fallback = 'render' ) {

	const filled = String( template || '' ).replace( /\{([^{}]+)\}/g, ( all, key ) => {

		const v = values[ key.trim().toLowerCase() ];
		return v == null ? '' : slug( v );

	} );

	const cleaned = filled.replace( /[\\/:*?"<>|\u0000-\u001f]/g, '' ).replace( /\s+/g, '-' ).replace( /-{2,}/g, '-' ).replace( /[_-]*_[_-]*/g, '_' ).replace( /^[_.-]+|[_.-]+$/g, '' );
	return cleaned.slice( 0, 120 ) || fallback;

}

/**
 * The base name (no extension) of a render or snapshot.
 * info: { template, project, width, height, fps, duration, camera, is360, date }
 */
export function renderBaseName( info ) {

	const date = info.date || new Date();
	return fillTemplate( info.template || DEFAULT_VIDEO_TEMPLATE, {
		project: projectName( info.project ) || 'strata',
		duration: info.duration > 0 ? durationLabel( info.duration ) : '',
		res: resolutionLabel( info.width, info.height ),
		fps: info.fps ? String( info.fps ) : '',
		date: dateLabel( date ),
		time: timeLabel( date ),
		camera: info.camera && ! /^(perspective)?camera$/i.test( info.camera ) ? info.camera : '',
		360: info.is360 ? '360' : '',
	}, 'render' );

}
