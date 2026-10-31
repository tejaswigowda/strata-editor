// ── subtitles.js ──────────────────────────────────────────────────────────────
// Pure subtitle (SRT) helpers: no DOM, no three.js, so the Render tab, the
// viewport caption preview, the JS shell and the node tests share one
// definition of a cue.
//
// A CUE is { id, start, end, text }. Times are OUTPUT video seconds (what an
// .srt's timestamps mean to any player). The cues live on the scene itself
// (scene.userData.renderSubtitles), so they are saved, versioned and committed
// with the scene JSON like every other piece of scene state.

export function formatSrtTime( seconds ) {

	const total = Math.max( 0, Math.round( ( Number.isFinite( seconds ) ? seconds : 0 ) * 1000 ) );
	const h = Math.floor( total / 3600000 );
	const m = Math.floor( ( total % 3600000 ) / 60000 );
	const s = Math.floor( ( total % 60000 ) / 1000 );
	const ms = total % 1000;
	const pad = ( n, len = 2 ) => String( n ).padStart( len, '0' );
	return `${ pad( h ) }:${ pad( m ) }:${ pad( s ) },${ pad( ms, 3 ) }`;

}

export function parseSrtTime( str ) {

	const m = String( str ).trim().match( /(\d+):(\d{2}):(\d{2})[,.](\d{1,3})/ );
	if ( ! m ) return 0;
	return ( + m[ 1 ] ) * 3600 + ( + m[ 2 ] ) * 60 + ( + m[ 3 ] ) + ( + m[ 4 ].padEnd( 3, '0' ) ) / 1000;

}

let idCounter = 0;
export function newCueId() {

	idCounter ++;
	return 'cue-' + Math.random().toString( 36 ).slice( 2, 8 ) + idCounter.toString( 36 );

}

/** Parse raw .srt text into cues (index lines optional/ignored, re-numbered on export). */
export function parseSrt( text ) {

	const blocks = String( text ).replace( /^\uFEFF/, '' ).replace( /\r/g, '' ).split( /\n\s*\n/ ).map( b => b.trim() ).filter( Boolean );
	const cues = [];

	for ( const block of blocks ) {

		const lines = block.split( '\n' );
		let idx = 0;
		if ( /^\d+$/.test( ( lines[ 0 ] || '' ).trim() ) ) idx = 1;
		const m = ( lines[ idx ] || '' ).match( /(.+?)\s*-->\s*(.+)/ );
		if ( ! m ) continue;

		cues.push( { id: newCueId(), start: parseSrtTime( m[ 1 ] ), end: parseSrtTime( m[ 2 ] ), text: lines.slice( idx + 1 ).join( '\n' ).trim() } );

	}

	return normalizeCues( cues );

}

export function cuesToSrt( cues ) {

	return normalizeCues( cues )
		.map( ( c, i ) => `${ i + 1 }\n${ formatSrtTime( c.start ) } --> ${ formatSrtTime( c.end ) }\n${ c.text }\n` )
		.join( '\n' );

}

export function activeCueAt( cues, t ) {

	return ( cues || [] ).find( c => t >= c.start && t < c.end ) || null;

}

/**
 * A clean, sorted copy of `cues`: numbers coerced, ids guaranteed and unique,
 * text a string, and end always after start. Never mutates its input.
 */
export function normalizeCues( cues ) {

	const seen = new Set();
	const out = [];
	for ( const c of Array.isArray( cues ) ? cues : [] ) {

		if ( ! c || typeof c !== 'object' ) continue;
		const start = Math.max( 0, Number.isFinite( + c.start ) ? + c.start : 0 );
		let end = Number.isFinite( + c.end ) ? + c.end : start + 3;
		if ( end <= start ) end = start + 0.1;
		let id = typeof c.id === 'string' && c.id ? c.id : newCueId();
		while ( seen.has( id ) ) id = newCueId();
		seen.add( id );
		out.push( { id, start: Math.round( start * 1000 ) / 1000, end: Math.round( end * 1000 ) / 1000, text: typeof c.text === 'string' ? c.text : String( c.text ?? '' ) } );

	}

	return out.sort( ( a, b ) => a.start - b.start || a.end - b.end );

}

/** Same cues (ignoring ids and order)? Used to avoid no-op commands and sync loops. */
export function cuesEqual( a, b ) {

	const key = c => `${ c.start }|${ c.end }|${ c.text }`;
	const x = normalizeCues( a ).map( key ), y = normalizeCues( b ).map( key );
	return x.length === y.length && x.every( ( v, i ) => v === y[ i ] );

}

/** Same cues AND same ids (cuesEqual does not look at ids: a rename is a real change to anything that links to a cue). */
export function cuesIdentical( a, b ) {

	const x = normalizeCues( a ), y = normalizeCues( b );
	return cuesEqual( x, y ) && x.every( ( c, i ) => c.id === y[ i ].id );

}
