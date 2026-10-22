// ── ViewLookLogic.js ──────────────────────────────────────────────────────────
// Pure logic behind the viewport's Frame guides and Look toggles (ViewLook.js): the aspect presets,
// the settings schema with its sanitising loader, where the letterboxed frame sits inside the
// viewport, when the overlays may draw, and the viewport-only "hide toon outlines" swap.
// No DOM, no three.js — node-tested in __tests__/viewLook.test.mjs.

export const STORAGE_KEY = 'strata/viewLook';

// Aspect presets for the letterbox. 'off' draws nothing; 'render' follows the Render tab's output size.
export const ASPECT_PRESETS = [
	{ id: 'off', label: 'Off', ratio: null },
	{ id: '16:9', label: '16:9', ratio: 16 / 9 },
	{ id: '2.39:1', label: '2.39:1 (scope)', ratio: 2.39 },
	{ id: '1.85:1', label: '1.85:1', ratio: 1.85 },
	{ id: '4:3', label: '4:3', ratio: 4 / 3 },
	{ id: '1:1', label: '1:1', ratio: 1 },
	{ id: '9:16', label: '9:16 (vertical)', ratio: 9 / 16 },
	{ id: 'render', label: 'Match render', ratio: null }
];

// EBU R95 style margins, as a fraction of the frame: action safe 93 %, title safe 90 %.
export const SAFE_ACTION = 0.93;
export const SAFE_TITLE = 0.9;

export const DEFAULTS = Object.freeze( {
	frame: 'off',
	safe: false,
	vignette: false, vignetteAmount: 0.5,
	grain: false, grainAmount: 0.35,
	glow: false, glowAmount: 0.4,
	hideOutlines: false,
	inPresent: false
} );

const clamp01 = v => Math.min( 1, Math.max( 0, v ) );

/** Merge untrusted stored JSON onto the defaults, dropping anything of the wrong type or range. */
export function sanitizeSettings( raw ) {

	const out = { ...DEFAULTS };
	if ( ! raw || typeof raw !== 'object' ) return out;

	if ( typeof raw.frame === 'string' && ASPECT_PRESETS.some( p => p.id === raw.frame ) ) out.frame = raw.frame;

	for ( const key of [ 'safe', 'vignette', 'grain', 'glow', 'hideOutlines', 'inPresent' ] ) {

		if ( typeof raw[ key ] === 'boolean' ) out[ key ] = raw[ key ];

	}

	for ( const key of [ 'vignetteAmount', 'grainAmount', 'glowAmount' ] ) {

		if ( typeof raw[ key ] === 'number' && Number.isFinite( raw[ key ] ) ) out[ key ] = clamp01( raw[ key ] );

	}

	return out;

}

export function loadSettings( storage ) {

	try {

		return sanitizeSettings( JSON.parse( storage.getItem( STORAGE_KEY ) ) );

	} catch ( e ) {

		return sanitizeSettings( null );

	}

}

export function saveSettings( storage, settings ) {

	try { storage.setItem( STORAGE_KEY, JSON.stringify( settings ) ); } catch ( e ) { /* storage blocked: the settings just last this session */ }

}

/** Width / height for a preset id; `renderSize` ({ width, height }) feeds 'render'. null = no frame. */
export function aspectRatio( frame, renderSize ) {

	if ( frame === 'render' ) {

		const ok = renderSize && renderSize.width > 0 && renderSize.height > 0;
		return ok ? renderSize.width / renderSize.height : 16 / 9;

	}

	const preset = ASPECT_PRESETS.find( p => p.id === frame );
	return preset ? preset.ratio : null;

}

/**
 * The frame rectangle (px, relative to the viewport) for `ratio` fitted inside a width × height box.
 * `ratio` null (frame off) means the whole viewport. Bars fill the rest.
 */
export function frameRect( width, height, ratio ) {

	if ( ! ( width > 0 ) || ! ( height > 0 ) || ! ( ratio > 0 ) ) return { x: 0, y: 0, width: Math.max( 0, width || 0 ), height: Math.max( 0, height || 0 ) };

	let w = width, h = width / ratio;
	if ( h > height ) { h = height; w = height * ratio; }

	return { x: ( width - w ) / 2, y: ( height - h ) / 2, width: w, height: h };

}

/** Inset rectangle (same coordinate space) for a safe-area fraction of `rect`. */
export function safeRect( rect, fraction ) {

	const w = rect.width * fraction, h = rect.height * fraction;
	return { x: rect.x + ( rect.width - w ) / 2, y: rect.y + ( rect.height - h ) / 2, width: w, height: h };

}

/**
 * What may be drawn right now. Nothing draws while exporting / rendering frames; present mode
 * (the viewer) only gets the overlays when "apply in present mode" is ticked.
 */
export function effectiveState( settings, { presentMode = false, exporting = false } = {} ) {

	const off = { frame: 'off', safe: false, vignette: 0, grain: 0, glow: 0, hideOutlines: false };
	if ( exporting || ( presentMode && ! settings.inPresent ) ) return off;

	return {
		frame: settings.frame,
		safe: settings.safe,
		vignette: settings.vignette ? settings.vignetteAmount : 0,
		grain: settings.grain ? settings.grainAmount : 0,
		glow: settings.glow ? settings.glowAmount : 0,
		hideOutlines: settings.hideOutlines
	};

}

/** True when any overlay or outline change would draw. */
export function anyActive( state ) {

	return state.frame !== 'off' || state.safe || state.vignette > 0 || state.grain > 0 || state.glow > 0 || state.hideOutlines;

}

/**
 * Viewport-only: hide every MToon / toon outline pass under `root` (materials flagged `isOutline`,
 * drawn as extra draw groups) by clearing `visible`. Returns restore(); the saved scene is untouched.
 */
export function hideOutlinePasses( root ) {

	const hidden = [];

	root.traverse( object => {

		const materials = Array.isArray( object.material ) ? object.material : [ object.material ];

		for ( const material of materials ) {

			if ( material && material.isOutline === true && material.visible !== false ) {

				material.visible = false;
				hidden.push( material );

			}

		}

	} );

	return function restore() {

		for ( const material of hidden ) material.visible = true;

	};

}
