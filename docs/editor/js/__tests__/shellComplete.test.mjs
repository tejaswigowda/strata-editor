// Run: node docs/editor/js/__tests__/shellComplete.test.mjs
// The Shell's autocomplete brain: ranking, where the cursor is in a call, member lists read from real objects, and the starters for an empty line.
import assert from 'node:assert';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname( fileURLToPath( import.meta.url ) );
const M = await import( pathToFileURL( path.join( here, '..', 'shellComplete.js' ) ).href );
const { fuzzyScore, rankItems, historyBoosts, enclosingCall, memberContext, argumentChoices, membersOf, hintOf, signatureFor, buildStarters, STATIC_MEMBERS } = M;

let pass = 0, fail = 0;
function test( name, fn ) {

	try { fn(); console.log( '  ✓ ' + name ); pass ++; }
	catch ( e ) { console.error( '  ✗ ' + name + '\n      ' + e.message ); fail ++; }

}

test( 'prefix beats initials beats substring beats letters in order; a miss is null', () => {

	assert.ok( fuzzyScore( 'ss', 'setScale' ) > fuzzyScore( 'ss', 'assess' ), 'initials over substring' );
	assert.ok( fuzzyScore( 'sc', 'scale' ) > fuzzyScore( 'sc', 'setScale' ), 'prefix over substring' );
	assert.ok( fuzzyScore( 'sc', 'obscure' ) > fuzzyScore( 'scr', 'sacred' ), 'substring over letters in order' );
	assert.ok( fuzzyScore( 'mt', 'moveTo' ) > fuzzyScore( 'mt', 'amtrak' ), 'initials over substring, again' );
	assert.strictEqual( fuzzyScore( 'zzz', 'scale' ), null );
	assert.strictEqual( fuzzyScore( '', 'anything' ), 0 );

} );

test( 'initials match across camelCase, underscores and dots', () => {

	assert.ok( fuzzyScore( 'mt', 'moveTo' ) > 60 );
	assert.ok( fuzzyScore( 'apc', 'Avocado_Pit_Cavity' ) > 60 );
	assert.ok( fuzzyScore( 'ap', '#Avocado_Pit' ) > 60 );                                  // a selector's # starts a word
	assert.strictEqual( fuzzyScore( 'x', 'moveTo' ), null );

} );

test( 'case: an exact-case prefix outranks a different-case one', () => {

	assert.ok( fuzzyScore( 'Sc', 'Scale' ) > fuzzyScore( 'Sc', 'scale' ) );

} );

test( 'ranking sorts by score, then by what the user types often, and keeps order with no prefix', () => {

	const items = [ { w: 'setScale' }, { w: 'scale' }, { w: 'scaleTo' }, { w: 'wireframe' } ];
	assert.deepStrictEqual( rankItems( 'sc', items ).map( x => x.w ), [ 'scale', 'scaleTo', 'setScale' ] );
	const boosts = historyBoosts( [ 'x.scaleTo(2)', 'y.scaleTo(3)', 'z.scaleTo(1)' ] );
	assert.ok( boosts.get( 'scaleTo' ) > 0 );
	assert.deepStrictEqual( rankItems( 'sc', items, { boosts } ).map( x => x.w )[ 0 ], 'scaleTo' );
	assert.deepStrictEqual( rankItems( '', items ).map( x => x.w ), items.map( x => x.w ) );
	assert.strictEqual( rankItems( '', Array.from( { length: 50 }, ( _, i ) => ( { w: 'w' + i } ) ) ).length, 24 );

} );

test( 'the call the cursor is in: its name, the argument, and whether it is inside a string', () => {

	let c = enclosingCall( "SEG.split('#Duck', { group: 'D', par" );
	assert.strictEqual( c.fn, 'SEG.split' ); assert.strictEqual( c.argIndex, 1 ); assert.strictEqual( c.nested, true ); assert.strictEqual( c.quote, null );
	c = enclosingCall( "$S('.wing').recolor('re" );
	assert.deepStrictEqual( [ c.fn, c.name, c.argIndex, c.quote, c.text ], [ 'recolor', 'recolor', 0, "'", 're' ] );
	c = enclosingCall( "$S('.wing').spin('y', " );
	assert.deepStrictEqual( [ c.name, c.argIndex, c.quote ], [ 'spin', 1, null ] );
	c = enclosingCall( "foo(bar(1, 2), " );
	assert.deepStrictEqual( [ c.name, c.argIndex ], [ 'foo', 1 ] );
	assert.strictEqual( enclosingCall( 'const x = 1' ), null );
	assert.strictEqual( enclosingCall( "log('a (b')" ), null );               // a parenthesis inside a string does not open a call
	assert.strictEqual( enclosingCall( "// $S('x'" ), null );                 // nor does one in a comment

} );

test( 'member context: a dotted name, not after a call', () => {

	assert.deepStrictEqual( memberContext( 'SEG.' ), { path: [ 'SEG' ], prefix: '' } );
	assert.deepStrictEqual( memberContext( 'x = editor.scene.chi' ), { path: [ 'editor', 'scene' ], prefix: 'chi' } );
	assert.strictEqual( memberContext( "$S('.x')." ), null );
	assert.strictEqual( memberContext( 'a.b(1).c' ), null );
	assert.strictEqual( memberContext( '1.5' ), null );
	assert.strictEqual( memberContext( "'a.b" ), null );

} );

test( 'argument choices: colours for recolor, axes for spin, light kinds for addLight, nothing for a free string', () => {

	const at = s => argumentChoices( enclosingCall( s ), [] );
	assert.strictEqual( at( "$S('.a').recolor('" ).kind, 'color' );
	assert.ok( at( "$S('.a').recolor('" ).items.some( i => i.w === 'red' ) );
	assert.deepStrictEqual( at( "$S('.a').spin('" ).items.map( i => i.w ), [ 'x', 'y', 'z' ] );
	assert.ok( at( "addLight('" ).items.some( i => i.w === 'spot' ) );
	assert.strictEqual( at( "$S('.a').spin('y', " ).kind, null );
	assert.strictEqual( at( "findObject('" ).kind, null );

} );

test( 'members are read from the real object, getters are never called, and underscores are hidden', () => {

	let called = false;
	const obj = { name: 'o', n: 3, list: [ 1, 2 ], f( a, b ) {}, g: ( x ) => x, get risky() { called = true; return 1; }, _hidden: 1 };
	const roots = { thing: obj, nested: { inner: obj } };
	const m = Object.fromEntries( membersOf( [ 'thing' ], roots ).map( x => [ x.w, x ] ) );
	assert.strictEqual( m.f.k, 'method' ); assert.strictEqual( m.f.h, '(a, b)' ); assert.strictEqual( m.g.h, '(x)' );
	assert.strictEqual( m.n.h, 'number' ); assert.strictEqual( m.list.h, 'array 2' ); assert.strictEqual( m.risky.h, 'getter' );
	assert.ok( ! ( '_hidden' in m ) );
	assert.strictEqual( called, false );
	assert.ok( membersOf( [ 'nested', 'inner' ], roots ).length > 3 );               // a path of data properties
	assert.strictEqual( membersOf( [ 'thing', 'risky' ], roots ), null );             // a path through a getter is not followed
	assert.strictEqual( membersOf( [ 'nowhere' ], roots ), null );
	assert.strictEqual( membersOf( [ 'process' ], roots ), null );                    // only the named roots and a short list of safe built-ins
	assert.ok( membersOf( [ 'Math' ], roots ).some( x => x.w === 'sqrt' && x.k === 'method' ) );
	assert.ok( membersOf( [ 'Math' ], roots ).some( x => x.w === 'PI' && x.k === 'prop' ) );

} );

test( 'SEG has its own members, with signatures', () => {

	const m = membersOf( [ 'SEG' ], {} );
	assert.deepStrictEqual( m.map( x => x.w ).sort(), STATIC_MEMBERS.SEG.map( x => x.w ).sort() );
	assert.ok( m.find( x => x.w === 'split' ).h.includes( 'source' ) );
	const sig = signatureFor( enclosingCall( "SEG.byMaterial('#Crate', " ), () => null );
	assert.deepStrictEqual( [ sig.name, sig.sig.startsWith( '(selector' ) ], [ 'SEG.byMaterial', true ] );
	assert.strictEqual( signatureFor( enclosingCall( 'mystery(' ), () => null ), null );
	assert.deepStrictEqual( signatureFor( enclosingCall( 'recolor(' ), w => ( w === 'recolor' ? '(color)' : null ) ), { name: 'recolor', sig: '(color)' } );

} );

test( 'a function hint comes from its source, or its arity when it is native', () => {

	assert.strictEqual( hintOf( function ( a, b = 2 ) {} ), '(a, b = 2)' );
	assert.strictEqual( hintOf( x => x ), '(x)' );
	assert.strictEqual( hintOf( Math.max ), '(a, b)' );
	assert.strictEqual( hintOf( () => 1 ), '()' );

} );

const base = { selected: null, classes: [], objectCount: 5, history: [] };

test( 'starters on an empty scene suggest a light and a box, not a word list', () => {

	const s = buildStarters( { ...base, objectCount: 0 } );
	assert.ok( s.some( x => x.group === 'The scene is empty' && x.w.startsWith( 'addLight' ) ) );
	assert.ok( s.length < 12 );

} );

test( 'starters use the selection: a textured mesh gets SEG.describe, a segmented group SEG.preview, the caret lands inside the quotes', () => {

	let s = buildStarters( { ...base, selected: { name: 'LOD3spShape', isMesh: true, textured: true, childCount: 0 } } );
	assert.strictEqual( s[ 0 ].w, "SEG.describe('#LOD3spShape')" );
	assert.strictEqual( s[ 0 ].group, 'Selected: LOD3spShape' );
	const rec = s.find( x => x.w.includes( 'recolor' ) );
	assert.strictEqual( rec.w.slice( 0, rec.caret ), "$S('#LOD3spShape').recolor('" );
	s = buildStarters( { ...base, selected: { name: 'Duck', hasRecord: true, childCount: 10 } } );
	assert.strictEqual( s[ 0 ].w, "SEG.preview('#Duck')" );
	assert.ok( s.some( x => x.w.includes( '.children()' ) && x.h.includes( '10 parts' ) ) );
	s = buildStarters( { ...base, selected: { name: "It's", isMesh: true, textured: false, childCount: 0 } } );
	assert.ok( s.some( x => x.w.includes( "'#It\\'s'" ) ) );                           // a quote in a name is escaped

} );

test( 'starters use the scene: its own classes first, then the last distinct commands, then a few ways to explore', () => {

	const s = buildStarters( { ...base, classes: [ { selector: '.wing', count: 2 }, { selector: 'mesh', count: 9 }, { selector: '#beak', count: 1 } ],
		history: [ "$S('.wing').recolor('red')", 'help', "$S('.wing').recolor('red')", 'multi\nline', 'lint()' ] } );
	const groups = [ ...new Set( s.map( x => x.group ) ) ];
	assert.deepStrictEqual( groups, [ 'In this scene', 'Recent', 'Explore' ] );
	assert.deepStrictEqual( s.filter( x => x.group === 'In this scene' ).map( x => x.w ), [ "$S('.wing')", "$S('#beak')" ] );   // a bare type (mesh) is not a starter
	assert.deepStrictEqual( s.filter( x => x.group === 'Recent' ).map( x => x.w ), [ 'lint()', "$S('.wing').recolor('red')" ] );   // newest first, no repeats, no help, no multi-line
	assert.ok( s.every( x => x.k === 'starter' ) );

} );

console.log( `\n${ pass } passed, ${ fail } failed` );
process.exit( fail ? 1 : 0 );
