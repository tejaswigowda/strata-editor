// ── EmptyHint.js ──────────────────────────────────────────────────────────────
// A small, dismissible first-run hint box used by empty panels (Scene outliner, Render tab camera
// sequence). It shows a sentence and 1-2 example commands (click copies one) and is hidden once the
// panel has content or the user dismisses it ('strata/hint/<id>' in localStorage).

const KEY = id => 'strata/hint/' + id;

export function isDismissed( id, storage = window.localStorage ) {

	try { return storage.getItem( KEY( id ) ) === '1'; } catch ( e ) { return false; }

}

/**
 * Build the hint. `examples` is [ { label?, code } ]. Returns { dom, setEmpty( bool ) }: call setEmpty( true )
 * while the panel is empty; the hint only shows then, and only if not dismissed.
 */
export function createEmptyHint( { id, title, text, examples = [] } ) {

	const dom = document.createElement( 'div' );
	dom.className = 'empty-hint';
	dom.setAttribute( 'role', 'note' );
	dom.dataset.hint = id;
	dom.hidden = true;

	const close = document.createElement( 'button' );
	close.type = 'button';
	close.className = 'empty-hint-close';
	close.textContent = '\u00d7';
	close.title = 'Dismiss this hint';
	close.setAttribute( 'aria-label', 'Dismiss hint: ' + title );
	dom.appendChild( close );

	const heading = document.createElement( 'div' );
	heading.className = 'empty-hint-title';
	heading.textContent = title;
	dom.appendChild( heading );

	const body = document.createElement( 'div' );
	body.className = 'empty-hint-text';
	body.textContent = text;
	dom.appendChild( body );

	for ( const example of examples ) {

		const row = document.createElement( 'button' );
		row.type = 'button';
		row.className = 'empty-hint-example';
		row.title = 'Click to copy' + ( example.label ? ': ' + example.label : '' );
		row.setAttribute( 'aria-label', 'Copy example command' + ( example.label ? ': ' + example.label : '' ) );

		if ( example.label ) {

			const label = document.createElement( 'span' );
			label.className = 'empty-hint-label';
			label.textContent = example.label;
			row.appendChild( label );

		}

		const code = document.createElement( 'code' );
		code.textContent = example.code;
		row.appendChild( code );

		row.addEventListener( 'click', function () {

			if ( navigator.clipboard && navigator.clipboard.writeText ) navigator.clipboard.writeText( example.code ).catch( function () {} );
			row.classList.add( 'copied' );
			setTimeout( function () { row.classList.remove( 'copied' ); }, 900 );

		} );

		dom.appendChild( row );

	}

	let empty = false;

	function refresh() {

		dom.hidden = ! ( empty && ! isDismissed( id ) );

	}

	close.addEventListener( 'click', function () {

		try { window.localStorage.setItem( KEY( id ), '1' ); } catch ( e ) { /* hidden for this session only */ }
		dom.hidden = true;

	} );

	return { dom, setEmpty( value ) { empty = !! value; refresh(); } };

}
