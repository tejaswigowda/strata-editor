// Numeric argument checking for the edit ops. Pure (no DOM / three).
//
// clamp() lets NaN straight through (Math.max/min of a non-number is NaN), so an op
// called with a bad number used to write NaN into a node's transform and still report
// success. An op must either apply to every matched node or fail cleanly (the "total"
// property), so numeric arguments are checked BEFORE anything is touched.

/**
 * @param {Record<string, [any, number | undefined]>} spec  name -> [value, fallback].
 *   fallback is used when the value is omitted (undefined / null); `undefined` = required.
 * @returns {{ ok: true, values: Record<string, number> } | { ok: false, message: string }}
 */
export function numericArgs( spec ) {

	const values = {};

	for ( const [ name, [ raw, fallback ] ] of Object.entries( spec ) ) {

		if ( raw === undefined || raw === null ) {

			if ( fallback === undefined ) return { ok: false, message: `${ name } is required (a finite number)` };
			values[ name ] = fallback;
			continue;

		}

		const n = typeof raw === 'string' && raw.trim() !== '' ? Number( raw ) : raw;

		if ( typeof n !== 'number' || ! Number.isFinite( n ) ) {

			return { ok: false, message: `${ name } must be a finite number, got ${ typeof raw === 'string' ? JSON.stringify( raw ) : String( raw ) }` };

		}

		values[ name ] = n;

	}

	return { ok: true, values };

}
