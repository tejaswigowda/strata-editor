// Run: node --test docs/player/__tests__/player.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import * as resolve from '../resolve.js';

const source = readFileSync( new URL( '../player.js', import.meta.url ), 'utf8' ).replace( /^import .*;$/gm, '' );
const base = 'https://fastly.jsdelivr.net/gh/owner/repo@film/v1/film/';

async function player() {

	const elements = new Map(), instances = [];
	const element = id => {

		if ( ! elements.has( id ) ) elements.set( id, {
			textContent: '', innerHTML: '', hidden: true, paused: true, currentTime: 0,
			events: {}, children: [],
			addEventListener( type, handler ) { this.events[ type ] = handler; },
			replaceChildren( ...children ) { this.children = children; },
			removeAttribute() {}, querySelectorAll: () => [], canPlayType: () => ''
		} );
		return elements.get( id );

	};
	class Hls {

		static Events = { ERROR: 'error', MANIFEST_PARSED: 'manifest', AUDIO_TRACKS_UPDATED: 'audioTracks', AUDIO_TRACK_SWITCHED: 'audioSwitched' };
		static isSupported() { return true; }
		constructor( config ) { this.config = config; this.handlers = {}; instances.push( this ); }
		on( event, fn ) { this.handlers[ event ] = fn; }
		loadSource( url ) { this.url = url; }
		attachMedia() {}
		destroy() { this.destroyed = true; }
		error( data ) { this.handlers.error( 'error', data ); }

	}
	const window = { Hls };
	window.self = window.top = window;
	const context = vm.createContext( {
		...resolve, window, navigator: { userAgent: 'Chrome' }, location: { search: '', hash: '' },
		document: { getElementById: element, documentElement: { classList: { toggle() {} }, style: { setProperty() {} } } },
		innerHeight: 800, addEventListener() {}, URL, AbortSignal,
		Option: class { constructor( text, value ) { Object.assign( this, { text, value } ); } },
		fetch: async () => ( { ok: true, json: async () => ( {} ), text: async () => '' } ),
		parseMaster: () => ( { renditions: [] } )
	} );
	vm.runInContext( source, context );
	await context.play( base );
	return { instances, element };

}

test( 'audio is selectable only when multiple tracks are available', async () => {

	const { instances: [ hls ], element } = await player();
	const picker = element( 'audio' );
	hls.audioTracks = [ { name: 'English' } ];
	hls.audioTrack = 0;
	hls.handlers.audioTracks();
	assert.equal( element( 'audioLabel' ).hidden, true );
	hls.audioTracks.push( { name: 'Español' } );
	hls.handlers.audioTracks();
	assert.equal( element( 'audioLabel' ).hidden, false );
	assert.equal( picker.children[ 1 ].text, 'Español' );
	picker.value = '1';
	picker.events.change();
	assert.equal( hls.audioTrack, 1 );
	assert.equal( element( 'video' ).currentTime, 0 );

} );

test( 'a nonfatal missing segment immediately switches hosts and preserves the position', async () => {

	for ( const code of [ 404, 0 ] ) {

		const { instances, element } = await player();
		const first = instances[ 0 ];
		element( 'video' ).currentTime = 12;
		first.error( { fatal: false, details: 'fragLoadError', response: { code } } );
		assert.equal( first.destroyed, true );
		assert.equal( instances.length, 2 );
		assert.equal( instances[ 1 ].url, resolve.alternateBases( base )[ 0 ] + 'master.m3u8' );
		assert.equal( instances[ 1 ].config.startPosition, 12 );
		assert.match( element( 'warn' ).textContent, /playing it from cdn\.jsdelivr\.net/ );
		first.error( { fatal: true, response: { code: 404 } } );
		assert.equal( instances.length, 2, 'late errors from the old player cannot skip another host' );

	}

} );

test( 'other recoverable errors stay on the host and a fatal forbidden response is reported', async () => {

	const { instances, element } = await player();
	for ( const data of [ { response: { code: 500 } }, { details: 'bufferStalledError' } ] ) instances[ 0 ].error( { fatal: false, ...data } );
	assert.equal( instances.length, 1 );
	assert.equal( instances[ 0 ].destroyed, undefined );
	instances[ 0 ].error( { fatal: true, details: 'fragLoadError', response: { code: 403 } } );
	assert.equal( instances.length, 1 );
	assert.match( element( 'error' ).textContent, /HTTP 403/ );

} );

test( 'the last host keeps its retries, then reports exhaustion rather than looping', async () => {

	const { instances, element } = await player();
	const hosts = resolve.candidateBases( base );
	for ( let i = 0; i < hosts.length - 1; i ++ ) instances[ i ].error( { fatal: false, response: { code: 404 } } );
	const last = instances.at( -1 );
	last.error( { fatal: false, response: { code: 404 } } );
	assert.equal( instances.length, hosts.length );
	assert.equal( last.destroyed, undefined );
	last.error( { fatal: true, details: 'fragLoadError', response: { code: 404 } } );
	assert.equal( instances.length, hosts.length );
	assert.equal( last.destroyed, true );
	assert.match( element( 'error' ).textContent, /HTTP 404.*tried .*raw\.githubusercontent\.com/ );

} );
