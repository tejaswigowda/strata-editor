// download.js: turning a published render (an HLS set of fragmented MP4) into one file a person can keep. Pure, no DOM, testable in node.
//
// A render's video ladder is CMAF-style: `init.mp4` and `segNNNNN.m4s` per rung, and a narrated render carries its audio as a SEPARATE rendition with its own
// init and segments. One rung's init and segments end to end is already a valid fragmented MP4, but a narrated render would lose its narration. So the two are
// merged here without touching a sample: the audio's track is added to the video's `moov` under a new track id, and the two runs of fragments are interleaved in
// time with their track ids and sequence numbers rewritten in place (no size changes, so every `trun` data offset stays right).
//
// Handled: version 0 and 1 of the boxes it reads, `styp` dropped, one or more `moof`+`mdat` per segment, fragments with `default-base-is-moof` (what Strata
// writes). Refused rather than guessed: a fragment with an absolute base offset (it would be wrong once moved), or with no `tfdt` (nothing to place it by).

const ascii = new TextDecoder( 'ascii' );
const u32 = ( b, at ) => ( ( b[ at ] << 24 ) | ( b[ at + 1 ] << 16 ) | ( b[ at + 2 ] << 8 ) | b[ at + 3 ] ) >>> 0;
const put32 = ( b, at, n ) => { b[ at ] = n >>> 24; b[ at + 1 ] = ( n >>> 16 ) & 255; b[ at + 2 ] = ( n >>> 8 ) & 255; b[ at + 3 ] = n & 255; };

/** The boxes between two offsets, as [{ type, start, end }]. */
export function readBoxes( b, start = 0, end = b.length ) {

	const out = [];
	for ( let at = start; at + 8 <= end; ) {

		let size = u32( b, at );
		const type = ascii.decode( b.subarray( at + 4, at + 8 ) );
		if ( size === 1 ) { if ( at + 16 > end ) throw new Error( 'download: a box is cut off' ); size = u32( b, at + 8 ) * 4294967296 + u32( b, at + 12 ); }
		else if ( size === 0 ) size = end - at;
		if ( size < 8 || at + size > end ) throw new Error( `download: a "${ type }" box does not fit its file` );
		out.push( { type, start: at, end: at + size } );
		at += size;

	}
	return out;

}

// the boxes this module reads and rebuilds never use a 64-bit size, so a payload starts 8 bytes in
const inside = ( b, box ) => readBoxes( b, box.start + 8, box.end );
const find = ( b, box, type ) => inside( b, box ).find( x => x.type === type );

function concat( parts ) {

	let n = 0;
	for ( const p of parts ) n += p.length;
	const out = new Uint8Array( n );
	let at = 0;
	for ( const p of parts ) { out.set( p, at ); at += p.length; }
	return out;

}

function makeBox( type, ...kids ) {

	const body = concat( kids ), out = new Uint8Array( 8 + body.length );
	put32( out, 0, out.length );
	for ( let i = 0; i < 4; i ++ ) out[ 4 + i ] = type.charCodeAt( i );
	out.set( body, 8 );
	return out;

}

// ── init segments ────────────────────────────────────────────────────────────────────────────────────────────

// Offsets from the start of a box (size and type take 8, version and flags 4): where the fields this module reads or rewrites are.
const MVHD_NEXT_ID = v => ( v === 1 ? 116 : 104 );
const TKHD_ID = v => ( v === 1 ? 28 : 20 );
const MDHD_TIMESCALE = v => ( v === 1 ? 28 : 20 );
const TREX_ID = 12, MFHD_SEQ = 12, TFHD_ID = 12, TFDT_TIME = 12;

/** What an init segment holds: its tracks (id and timescale, and where the id is) and the boxes of its moov. */
export function readInit( b ) {

	const top = readBoxes( b ), moov = top.find( x => x.type === 'moov' ), ftyp = top.find( x => x.type === 'ftyp' );
	if ( ! moov || ! ftyp ) throw new Error( 'download: the init segment needs an ftyp and a moov' );
	const kids = inside( b, moov ), mvhd = kids.find( x => x.type === 'mvhd' ), mvex = kids.find( x => x.type === 'mvex' );
	if ( ! mvhd ) throw new Error( 'download: the init segment has no mvhd' );
	const traks = kids.filter( x => x.type === 'trak' ).map( box => {

		const tkhd = find( b, box, 'tkhd' ), mdia = find( b, box, 'mdia' ), mdhd = mdia && find( b, mdia, 'mdhd' );
		if ( ! tkhd || ! mdhd ) throw new Error( 'download: a track has no tkhd or no mdhd' );
		const idAt = tkhd.start + TKHD_ID( b[ tkhd.start + 8 ] );
		return { box, id: u32( b, idAt ), idAt, timescale: u32( b, mdhd.start + MDHD_TIMESCALE( b[ mdhd.start + 8 ] ) ) };

	} );
	if ( ! traks.length ) throw new Error( 'download: the init segment has no track' );
	return { ftyp, moov, kids, mvhd, mvex, traks, trexes: mvex ? inside( b, mvex ).filter( x => x.type === 'trex' ) : [] };

}

/** One init segment holding the tracks of both, the second's renumbered after the first's: { bytes, ids: Map(old audio id → new id), timescales: Map(id → timescale) }. */
export function mergeInits( videoBytes, audioBytes ) {

	const v = readInit( videoBytes ), a = readInit( audioBytes );
	let next = Math.max( ...v.traks.map( t => t.id ) ) + 1;
	const ids = new Map(), timescales = new Map( v.traks.map( t => [ t.id, t.timescale ] ) );
	const audioTraks = a.traks.map( t => {

		const copy = audioBytes.slice( t.box.start, t.box.end ), id = next ++;
		ids.set( t.id, id ); timescales.set( id, t.timescale );
		put32( copy, t.idAt - t.box.start, id );
		return copy;

	} );
	const audioTrexes = a.trexes.map( t => {

		const copy = audioBytes.slice( t.start, t.end ), id = ids.get( u32( copy, TREX_ID ) );
		if ( id === undefined ) throw new Error( 'download: the audio init has a trex for a track it does not have' );
		put32( copy, TREX_ID, id );
		return copy;

	} );
	const mvhd = videoBytes.slice( v.mvhd.start, v.mvhd.end );
	put32( mvhd, MVHD_NEXT_ID( mvhd[ 8 ] ), next );
	const slice = x => videoBytes.subarray( x.start, x.end );
	const mvex = makeBox( 'mvex', ...( v.mvex ? inside( videoBytes, v.mvex ).map( slice ) : [] ), ...audioTrexes );
	const rest = v.kids.filter( x => ! [ 'mvhd', 'trak', 'mvex' ].includes( x.type ) ).map( slice );
	const moov = makeBox( 'moov', mvhd, ...v.traks.map( t => slice( t.box ) ), ...audioTraks, mvex, ...rest );
	return { bytes: concat( [ slice( v.ftyp ), moov ] ), ids, timescales };

}

// ── fragments ────────────────────────────────────────────────────────────────────────────────────────────────

/** The moof+mdat pairs of one media segment as byte copies; the styp and anything else is dropped. */
export function readFragments( seg ) {

	const out = [];
	let open = null;
	for ( const bx of readBoxes( seg ) ) {

		if ( bx.type === 'moof' ) { open = { start: bx.start, moofEnd: bx.end, end: bx.end }; out.push( open ); }
		else if ( bx.type === 'mdat' && open ) open.end = bx.end;

	}
	return out.map( f => ( { bytes: seg.slice( f.start, f.end ), moofSize: f.moofEnd - f.start } ) );

}

/** Rewrite a fragment in place for the merged file: its sequence number, and (for audio) its track id. Returns { track, time } where time is seconds. */
export function placeFragment( frag, { sequence, ids, timescales } ) {

	const b = frag.bytes, moof = readBoxes( b, 0, frag.moofSize )[ 0 ];
	put32( b, find( b, moof, 'mfhd' ).start + MFHD_SEQ, sequence );
	let track = null, time = null;
	for ( const traf of inside( b, moof ).filter( x => x.type === 'traf' ) ) {

		const tfhd = find( b, traf, 'tfhd' ), tfdt = find( b, traf, 'tfdt' );
		if ( ! tfhd ) throw new Error( 'download: a fragment has no tfhd' );
		if ( u32( b, tfhd.start + 8 ) & 1 ) throw new Error( 'download: a fragment with an absolute base data offset cannot be moved' );
		if ( ! tfdt ) throw new Error( 'download: a fragment has no tfdt, so there is nothing to place it by' );
		const old = u32( b, tfhd.start + TFHD_ID ), id = ids && ids.has( old ) ? ids.get( old ) : old;
		put32( b, tfhd.start + TFHD_ID, id );
		const t = b[ tfdt.start + 8 ] === 1 ? u32( b, tfdt.start + TFDT_TIME ) * 4294967296 + u32( b, tfdt.start + TFDT_TIME + 4 ) : u32( b, tfdt.start + TFDT_TIME );
		if ( track === null ) { track = id; time = t / ( timescales.get( id ) || 1 ); }

	}
	if ( track === null ) throw new Error( 'download: a fragment has no traf' );
	return { track, time };

}

/**
 * One file from a video run and, if there is one, an audio run. Each is { init: Uint8Array, segments: Uint8Array[] }. Returns { parts, bytes, fragments, tracks },
 * parts being what to hand to a Blob. The inputs are not changed.
 */
export function mergeFmp4( video, audio = null ) {

	let init = video.init, ids = null, timescales = new Map( readInit( video.init ).traks.map( t => [ t.id, t.timescale ] ) );
	if ( audio ) { const m = mergeInits( video.init, audio.init ); init = m.bytes; ids = m.ids; timescales = m.timescales; }
	const frags = [];
	const take = ( run, source ) => { for ( const seg of run.segments ) for ( const f of readFragments( seg ) ) frags.push( { f, source } ); };
	take( video, 0 ); if ( audio ) take( audio, 1 );

	// place each fragment, then order by time (video before audio at the same instant) and number them in that order
	for ( const x of frags ) Object.assign( x, placeFragment( x.f, { sequence: 1, ids: x.source === 1 ? ids : null, timescales } ) );
	frags.sort( ( p, q ) => p.time - q.time || p.source - q.source );
	frags.forEach( ( x, i ) => placeFragment( x.f, { sequence: i + 1, ids: null, timescales } ) );   // ids are already rewritten: only the number changes
	const parts = [ init, ...frags.map( x => x.f.bytes ) ];
	return { parts, bytes: parts.reduce( ( n, p ) => n + p.length, 0 ), fragments: frags.length, tracks: [ ...timescales.keys() ] };

}

// ── playlists ────────────────────────────────────────────────────────────────────────────────────────────────

/** A media playlist: the init segment's uri and the segments in order, with their durations. */
export function parseMediaPlaylist( text ) {

	const out = { init: null, segments: [], duration: 0 };
	let dur = null;
	for ( const raw of String( text ).split( /\r?\n/ ) ) {

		const line = raw.trim();
		if ( line.startsWith( '#EXT-X-MAP:' ) ) { const m = /URI="([^"]+)"/.exec( line ); if ( m ) out.init = m[ 1 ]; }
		else if ( line.startsWith( '#EXTINF:' ) ) dur = parseFloat( line.slice( 8 ) );
		else if ( line && ! line.startsWith( '#' ) ) { out.segments.push( { uri: line, duration: dur || 0 } ); out.duration += dur || 0; dur = null; }

	}
	return out;

}

function attributes( s ) {

	const out = {};
	for ( const m of s.matchAll( /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g ) ) out[ m[ 1 ] ] = m[ 2 ].replace( /^"|"$/g, '' );
	return out;

}

/** A master playlist: the renditions (best first), and the audio and subtitle media they can be played with. */
export function parseMaster( text ) {

	const lines = String( text ).split( /\r?\n/ ).map( l => l.trim() );
	const renditions = [], audio = [], subtitles = [];
	for ( let i = 0; i < lines.length; i ++ ) {

		if ( lines[ i ].startsWith( '#EXT-X-MEDIA:' ) ) {

			const a = attributes( lines[ i ].slice( 13 ) ), item = { group: a[ 'GROUP-ID' ], name: a.NAME, language: a.LANGUAGE, uri: a.URI, default: a.DEFAULT === 'YES' };
			if ( a.TYPE === 'AUDIO' && a.URI ) audio.push( item ); else if ( a.TYPE === 'SUBTITLES' && a.URI ) subtitles.push( item );

		} else if ( lines[ i ].startsWith( '#EXT-X-STREAM-INF:' ) ) {

			const a = attributes( lines[ i ].slice( 18 ) ), uri = lines.slice( i + 1 ).find( l => l && ! l.startsWith( '#' ) );
			const [ width, height ] = ( a.RESOLUTION || '0x0' ).split( 'x' ).map( Number );
			if ( uri ) renditions.push( { uri, width, height, bandwidth: Number( a.BANDWIDTH ) || 0, average: Number( a[ 'AVERAGE-BANDWIDTH' ] ) || 0, frameRate: Number( a[ 'FRAME-RATE' ] ) || 0, audioGroup: a.AUDIO || null, name: uri.split( '/' )[ 0 ] } );

		}

	}
	renditions.sort( ( p, q ) => q.height - p.height || q.bandwidth - p.bandwidth );
	return { renditions, audio, subtitles };

}

/** The audio playlist a rendition is played with, or null (a silent render has none). */
export function audioFor( master, rendition ) {

	const group = master.audio.filter( a => a.group === rendition.audioGroup );
	return group.find( a => a.default ) || group[ 0 ] || null;

}

/** What a download is likely to weigh, from the playlist's own average bandwidth (which includes its audio) and the film's length. */
export function estimateBytes( rendition, seconds ) {

	const bps = rendition.average || rendition.bandwidth;
	return bps && seconds ? Math.round( bps * seconds / 8 ) : null;

}

export function formatBytes( n ) {

	if ( n == null ) return '';
	return n >= 1e9 ? ( n / 1e9 ).toFixed( 1 ) + ' GB' : n >= 1e6 ? ( n / 1e6 ).toFixed( n >= 1e8 ? 0 : 1 ) + ' MB' : Math.max( 1, Math.round( n / 1e3 ) ) + ' kB';

}

/** A file name for a download: the scene and what it is, with nothing a file system minds. */
export function downloadName( scene, what, ext ) {

	const slug = s => String( s || '' ).normalize( 'NFKD' ).replace( /[^\w+.-]+/g, '-' ).replace( /^-+|-+$/g, '' ) || 'render';
	return `${ slug( scene ) }${ what ? '-' + slug( what ) : '' }.${ ext }`;

}
