// Colour cues for X / Y / Z number fields, matching the viewport gizmo and the view cube:
// X red, Y green, Z blue (the colours live in css/main.css as --axis-x / --axis-y / --axis-z).

const AXES = [ 'x', 'y', 'z' ];

/** Tag three UINumber fields (or raw inputs) as the X, Y and Z of one vector. Returns them unchanged. */
export function tintAxes( x, y, z ) {

	[ x, y, z ].forEach( ( field, i ) => {

		const dom = field && field.dom ? field.dom : field;
		if ( ! dom || ! dom.classList ) return;
		dom.classList.add( 'axis-field', 'axis-' + AXES[ i ] );
		dom.dataset.axis = AXES[ i ].toUpperCase();
		if ( ! dom.title ) dom.title = AXES[ i ].toUpperCase();

	} );

	return [ x, y, z ];

}
