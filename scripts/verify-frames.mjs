#!/usr/bin/env node
// The shuffled-order frame test (guides/TIME_SOURCES.md), run headless against a Strata server: renders a scene offline in Chrome with Verify set, and exits 1
// if any frame depends on more than n / fps. Run it on a subset in CI (the default, every 17th frame) and on every frame before a determinism claim is published.
//
//   node scripts/verify-frames.mjs --scene '#repo=tejaswigowda/test1@<sha>&file=projectile.json'
//   node scripts/verify-frames.mjs --scene '#repo=…&file=…' --every all --res 640 --fps 24 --encoder software
//   options: --url http://127.0.0.1:5500/   the editor (docs/ served; STRATA_NO_ISOLATION=1 is not needed)
//            --first N --last N              a frame range (blank: the whole render)
//            --out result.json               also write { verification, root, hashes } (the frame hashes, to diff two runs)
//
// It needs playwright-core and a Chrome (npm i playwright-core). Software GL (SwiftShader) is used, so it runs on a machine with no GPU: the claim is per device.

import fs from 'node:fs';

const args = Object.fromEntries( process.argv.slice( 2 ).reduce( ( acc, a, i, all ) => ( a.startsWith( '--' ) ? [ ...acc, [ a.slice( 2 ), all[ i + 1 ] && ! all[ i + 1 ].startsWith( '--' ) ? all[ i + 1 ] : 'true' ] ] : acc ), [] ) );
if ( ! args.scene ) { console.error( 'usage: node scripts/verify-frames.mjs --scene \'#repo=owner/name@<sha>&file=scene.json\' [--every 17|all] [--res 640|1280] [--fps 24|30|60] [--encoder software|hardware]' ); process.exit( 2 ); }

const { chromium } = await import( 'playwright-core' ).catch( () => { console.error( 'playwright-core is needed: npm i playwright-core' ); process.exit( 2 ); } );
const base = args.url || 'http://127.0.0.1:5500/';
const every = args.every === 'all' ? 'All' : 'Every 17th';
const timeoutMs = Number( args.timeout || 3600 ) * 1000;

const browser = await chromium.launch( { channel: 'chrome', headless: true, args: [ '--enable-unsafe-webgpu', '--use-angle=swiftshader', '--ignore-gpu-blocklist' ] } );
const page = await ( await browser.newContext( { viewport: { width: 1400, height: 900 }, acceptDownloads: true } ) ).newPage();
page.on( 'pageerror', e => console.error( 'page error:', e.message.slice( 0, 200 ) ) );
page.on( 'console', m => { if ( m.type() === 'info' && /Shuffled-order/.test( m.text() ) ) console.log( m.text() ); } );

try {

	await page.goto( base + args.scene, { waitUntil: 'load' } );
	await page.waitForFunction( () => window.editor && editor.scene.children.length > 1 && editor.timeline && editor.timeline.duration > 0, null, { timeout: 180000 } );
	await page.waitForTimeout( 6000 );
	await page.evaluate( () => { for ( const d of document.body.querySelectorAll( ':scope > div' ) ) if ( /Cancel/.test( d.textContent ) && getComputedStyle( d ).position === 'fixed' ) d.remove(); } );     // the player's Play overlay
	await page.evaluate( () => { for ( const name of [ 'render', 'video' ] ) [ ...document.querySelectorAll( '.tab-label' ) ].find( e => e.textContent.trim().toLowerCase() === name ).click(); } );
	await page.waitForTimeout( 800 );

	// the selects in the Video pane, by what they offer (not by position)
	const choose = ( marker, text ) => page.evaluate( ( [ marker, text ] ) => {

		const s = [ ...document.querySelectorAll( '#render select' ) ].find( s => [ ...s.options ].some( o => o.text.startsWith( marker ) ) && [ ...s.options ].some( o => o.text.startsWith( text ) ) );
		if ( ! s ) throw new Error( `no select offers "${ text }"` );
		s.value = [ ...s.options ].find( o => o.text.startsWith( text ) ).value;
		s.dispatchEvent( new Event( 'change', { bubbles: true } ) );

	}, [ marker, text ] );
	await choose( '640', args.res === '1280' ? '1280' : args.res === '854' ? '854' : '640' );
	await choose( '24', args.fps || '24' );
	await choose( 'Hardware', args.encoder === 'hardware' ? 'Hardware' : 'Software' );
	await choose( 'Off (frames', every );
	if ( args.first ) await page.locator( '#render input[placeholder="first"]' ).first().fill( args.first );
	if ( args.last ) await page.locator( '#render input[placeholder="last"]' ).first().fill( args.last );

	await page.evaluate( () => { editor.lastRender = null; } );
	await page.evaluate( () => [ ...document.querySelectorAll( 'button' ) ].find( e => /Render & Export/.test( e.textContent ) ).click() );
	await page.waitForFunction( () => !! editor.lastRender, null, { timeout: timeoutMs, polling: 3000 } );
	const result = await page.evaluate( () => ( { verification: editor.lastRender.verification, root: editor.lastRender.frameHashes.root, first: editor.lastRender.frameHashes.first, hashes: editor.lastRender.frameHashes.hashes } ) );
	if ( args.out ) fs.writeFileSync( args.out, JSON.stringify( result ) );
	const v = result.verification;
	console.log( JSON.stringify( { ...v, mismatched_frames: v.mismatched_frames.slice( 0, 30 ), root: result.root } ) );
	await browser.close();
	process.exit( v.passed ? 0 : 1 );

} catch ( e ) {

	console.error( 'verify-frames failed:', e.message.split( '\n' )[ 0 ] );
	await browser.close();
	process.exit( 2 );

}
