// ── Mp4Muxer.js ────────────────────────────────────────────────────────────────
// A small ISO-BMFF (MP4) writer for ONE H.264 video track, built for the offline renderer:
//   - constant frame rate by construction: one `stts` entry, count = frames, delta = 1000 ticks
//     on a timescale of fps * 1000, so ffprobe reports r_frame_rate = fps/1
//   - exact: nb_frames equals the number of chunks added, duration is frames / fps
//   - refuses irregular or out-of-order timestamps instead of writing a quietly wrong file
//   - no wall clock anywhere (creation/modification times are 0), so the same chunks give the same bytes
//   - `moov` before `mdat`, so the file streams, and the 360 metadata injector can splice after `ftyp`
// Samples arrive as WebCodecs EncodedVideoChunks in AVCC form (length-prefixed NALs, `avc: { format: 'avc' }`),
// and the avcC description comes with the first chunk's decoder config. B-frames are not supported: decode
// order must equal presentation order, which is checked.

const enc = new TextEncoder();

function concat( parts ) {

	let size = 0;
	for ( const p of parts ) size += p.length;
	const out = new Uint8Array( size );
	let at = 0;
	for ( const p of parts ) { out.set( p, at ); at += p.length; }
	return out;

}

const u8 = ( ...v ) => Uint8Array.from( v );
const u16 = n => u8( ( n >>> 8 ) & 255, n & 255 );
const u32 = n => u8( ( n >>> 24 ) & 255, ( n >>> 16 ) & 255, ( n >>> 8 ) & 255, n & 255 );
const zeros = n => new Uint8Array( n );
const ascii = s => enc.encode( s );

function box( type, ...children ) {

	const body = concat( children );
	return concat( [ u32( body.length + 8 ), ascii( type ), body ] );

}

const fullBox = ( type, version, flags, ...children ) => box( type, u8( version, ( flags >>> 16 ) & 255, ( flags >>> 8 ) & 255, flags & 255 ), ...children );

const MATRIX = concat( [ u32( 0x00010000 ), u32( 0 ), u32( 0 ), u32( 0 ), u32( 0x00010000 ), u32( 0 ), u32( 0 ), u32( 0 ), u32( 0x40000000 ) ] );

export class Mp4Muxer {

	/** @param {{ width:number, height:number, fps:number }} o  fps must be a whole number */
	constructor( { width, height, fps } ) {

		if ( ! Number.isInteger( fps ) || fps <= 0 ) throw new Error( 'Mp4Muxer: fps must be a positive whole number' );
		if ( width % 2 || height % 2 ) throw new Error( `Mp4Muxer: H.264 needs even dimensions, got ${ width } \u00d7 ${ height }` );
		this.width = width;
		this.height = height;
		this.fps = fps;
		this.timescale = fps * 1000;
		this.delta = 1000;
		this.samples = [];
		this.keyframes = [];
		this.avcC = null;
		this.baseUs = null;

	}

	/**
	 * @param {Uint8Array} data  one frame, AVCC
	 * @param {{ key:boolean, timestampUs:number, description?:Uint8Array }} o
	 */
	addChunk( data, { key, timestampUs, description } ) {

		const k = this.samples.length;
		if ( k === 0 ) {

			if ( ! description ) throw new Error( 'Mp4Muxer: the first chunk needs the avcC description from the encoder' );
			this.avcC = description;
			this.baseUs = timestampUs;
			if ( ! key ) throw new Error( 'Mp4Muxer: the first chunk must be a keyframe' );

		}

		// frame k must sit exactly k frame-times after the first: anything else is a dropped, repeated or reordered frame
		const expected = this.baseUs + Math.round( k * 1e6 / this.fps );
		if ( Math.abs( timestampUs - expected ) > 1 ) {

			throw new Error( `Mp4Muxer: frame ${ k } has timestamp ${ timestampUs } \u00b5s, expected ${ expected } \u00b5s (dropped, repeated or reordered frame)` );

		}

		if ( key ) this.keyframes.push( k + 1 );
		this.samples.push( data );

	}

	get frameCount() {

		return this.samples.length;

	}

	/** The finished file, as parts for a Blob. */
	finish() {

		const n = this.samples.length;
		if ( n === 0 ) throw new Error( 'Mp4Muxer: no frames were added' );

		const ftyp = box( 'ftyp', ascii( 'isom' ), u32( 512 ), ascii( 'isom' ), ascii( 'iso2' ), ascii( 'avc1' ), ascii( 'mp41' ) );
		let mdatSize = 8;
		for ( const s of this.samples ) mdatSize += s.length;
		if ( mdatSize > 0xffffffff ) throw new Error( 'Mp4Muxer: output larger than 4 GB is not supported' );

		const moovWithOffset = offset => this._moov( offset );
		const moovSize = moovWithOffset( 0 ).length; // the size does not depend on the offset's value
		const moov = moovWithOffset( ftyp.length + moovSize + 8 );

		return [ ftyp, moov, concat( [ u32( mdatSize ), ascii( 'mdat' ) ] ), ...this.samples ];

	}

	_moov( dataOffset ) {

		const n = this.samples.length;
		const duration = n * this.delta;

		const mvhd = fullBox( 'mvhd', 0, 0,
			u32( 0 ), u32( 0 ), u32( this.timescale ), u32( duration ),
			u32( 0x00010000 ), u16( 0x0100 ), zeros( 10 ), MATRIX, zeros( 24 ), u32( 2 ) );

		const tkhd = fullBox( 'tkhd', 0, 3,
			u32( 0 ), u32( 0 ), u32( 1 ), u32( 0 ), u32( duration ),
			zeros( 8 ), u16( 0 ), u16( 0 ), u16( 0 ), u16( 0 ), MATRIX, u32( this.width * 65536 ), u32( this.height * 65536 ) );

		const mdhd = fullBox( 'mdhd', 0, 0, u32( 0 ), u32( 0 ), u32( this.timescale ), u32( duration ), u16( 0x55c4 ), u16( 0 ) );
		const hdlr = fullBox( 'hdlr', 0, 0, u32( 0 ), ascii( 'vide' ), zeros( 12 ), ascii( 'VideoHandler\0' ) );

		const vmhd = fullBox( 'vmhd', 0, 1, u16( 0 ), zeros( 6 ) );
		const dinf = box( 'dinf', fullBox( 'dref', 0, 0, u32( 1 ), fullBox( 'url ', 0, 1 ) ) );

		const compressor = new Uint8Array( 32 );
		const avc1 = box( 'avc1',
			zeros( 6 ), u16( 1 ), zeros( 16 ), u16( this.width ), u16( this.height ),
			u32( 0x00480000 ), u32( 0x00480000 ), u32( 0 ), u16( 1 ), compressor, u16( 0x18 ), u16( 0xffff ),
			box( 'avcC', this.avcC ),
			// BT.709, limited range: what the encoder writes for an sRGB canvas, stated explicitly
			box( 'colr', ascii( 'nclx' ), u16( 1 ), u16( 1 ), u16( 1 ), u8( 0 ) ) );
		const stsd = fullBox( 'stsd', 0, 0, u32( 1 ), avc1 );

		const stts = fullBox( 'stts', 0, 0, u32( 1 ), u32( n ), u32( this.delta ) );
		const stss = fullBox( 'stss', 0, 0, u32( this.keyframes.length ), ...this.keyframes.map( u32 ) );
		const stsc = fullBox( 'stsc', 0, 0, u32( 1 ), u32( 1 ), u32( n ), u32( 1 ) ); // every sample in one chunk
		const sizes = new Uint8Array( n * 4 );
		const view = new DataView( sizes.buffer );
		this.samples.forEach( ( s, i ) => view.setUint32( i * 4, s.length, false ) );
		const stsz = fullBox( 'stsz', 0, 0, u32( 0 ), u32( n ), sizes );
		const stco = fullBox( 'stco', 0, 0, u32( 1 ), u32( dataOffset ) );

		const stbl = box( 'stbl', stsd, stts, stss, stsc, stsz, stco );
		const trak = box( 'trak', tkhd, box( 'mdia', mdhd, hdlr, box( 'minf', vmhd, dinf, stbl ) ) );
		return box( 'moov', mvhd, trak );

	}

}
