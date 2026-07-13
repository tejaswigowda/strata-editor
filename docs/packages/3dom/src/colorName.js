// ── colorName.js ──────────────────────────────────────────────────────────────
// Map an RGB color to a human-readable name via HSV bucketing. Pure math, no
// model. Returns { name, base } where `base` is the coarse bucket used for query
// matching ("dark red" → base "red") and `name` is the display string.
//
// This is intentionally approximate — good for "red/green/blue/gray/metal", not
// for fine shade distinctions ("teal" vs "cyan"). Don't overclaim precision.

function rgbToHsv( r, g, b ) {

	const max = Math.max( r, g, b );
	const min = Math.min( r, g, b );
	const v   = max;
	const d   = max - min;
	const s   = max === 0 ? 0 : d / max;

	let h = 0;
	if ( d !== 0 ) {

		if ( max === r ) h = ( ( g - b ) / d ) % 6;
		else if ( max === g ) h = ( b - r ) / d + 2;
		else h = ( r - g ) / d + 4;
		h *= 60;
		if ( h < 0 ) h += 360;

	}

	return { h, s, v };

}

/**
 * @param {number} r 0..1
 * @param {number} g 0..1
 * @param {number} b 0..1
 * @returns {{ name: string, base: string }}
 */
export function rgbToColorName( r, g, b ) {

	const { h, s, v } = rgbToHsv( r, g, b );

	// ── Achromatic (grayscale) ──────────────────────────────────────────────
	if ( s < 0.12 ) {

		if ( v < 0.10 ) return { name: 'black',      base: 'black' };
		if ( v < 0.32 ) return { name: 'dark gray',  base: 'gray'  };
		if ( v < 0.68 ) return { name: 'gray',       base: 'gray'  };
		if ( v < 0.90 ) return { name: 'light gray', base: 'gray'  };
		return { name: 'white', base: 'white' };

	}

	// ── Chromatic — bucket by hue ───────────────────────────────────────────
	let base;
	if ( h < 15 || h >= 345 ) base = 'red';
	else if ( h < 45 )  base = 'orange';
	else if ( h < 70 )  base = 'yellow';
	else if ( h < 100 ) base = 'lime';
	else if ( h < 160 ) base = 'green';
	else if ( h < 190 ) base = 'teal';
	else if ( h < 210 ) base = 'cyan';
	else if ( h < 255 ) base = 'blue';
	else if ( h < 290 ) base = 'purple';
	else base = 'magenta';

	// Brown is a dark, saturated orange/red
	if ( ( base === 'orange' || base === 'red' ) && v < 0.55 && s > 0.35 ) {

		return { name: 'brown', base: 'brown' };

	}

	// Pink is a light, less-saturated red/magenta
	if ( ( base === 'red' || base === 'magenta' ) && v > 0.8 && s < 0.55 ) {

		return { name: 'pink', base: 'pink' };

	}

	const qualifier = v < 0.42 ? 'dark ' : ( v > 0.88 && s < 0.55 ) ? 'light ' : '';
	return { name: qualifier + base, base };

}

/**
 * Convenience: accepts a THREE.Color and returns { name, base, hex }.
 */
export function colorToName( color ) {

	const { name, base } = rgbToColorName( color.r, color.g, color.b );
	return { name, base, hex: '#' + color.getHexString() };

}
