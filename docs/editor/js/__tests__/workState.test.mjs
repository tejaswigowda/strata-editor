// Node tests for the unsaved-work logic (hash, dirty tracker, recover decision, wording). Run with:
//   node docs/editor/js/__tests__/workState.test.mjs

import assert from 'node:assert';
import {
	hashString, workSnapshotString, hashWork, sourceKey, sourceLabel,
	createDirtyTracker, decideRecovery, wouldClobberUnsaved, relativeTime, recoverPromptText,
	describeChanges, sourceFile, recoverPrompt
} from '../workState.js';

let pass = 0, fail = 0;
function test( name, fn ) {

	try { fn(); console.log( '  ✓ ' + name ); pass ++; }
	catch ( e ) { console.error( '  ✗ ' + name + '\n      ' + ( e.stack || e.message ).split( '\n' ).slice( 0, 4 ).join( '\n      ' ) ); fail ++; }

}

test( 'hashString is deterministic and sensitive to every character', () => {

	assert.strictEqual( hashString( 'abc' ), hashString( 'abc' ) );
	assert.notStrictEqual( hashString( 'abc' ), hashString( 'abd' ) );
	assert.notStrictEqual( hashString( 'ab' ), hashString( 'ba' ) );
	assert.notStrictEqual( hashString( '' ), hashString( ' ' ) );

} );

test( 'the work hash ignores camera, controls and history but not scene content', () => {

	const base = { scene: { object: { children: [ 1 ] } }, animations: [], scripts: {}, camera: { a: 1 }, controls: { x: 0 }, history: { undos: [] } };
	const moved = { ...base, camera: { a: 2 }, controls: { x: 9 }, history: { undos: [ 1, 2 ] } };
	const edited = { ...base, scene: { object: { children: [ 1, 2 ] } } };
	const timeline = { ...base, animations: [ { clip: 'c' } ] };

	assert.strictEqual( hashWork( base ), hashWork( moved ) );
	assert.notStrictEqual( hashWork( base ), hashWork( edited ) );
	assert.notStrictEqual( hashWork( base ), hashWork( timeline ) );
	assert.strictEqual( workSnapshotString( null ), '{}' );

} );

test( 'lazily derived userData (descriptors) does not count as an edit; real userData does', () => {

	const mesh = ( userData ) => ( { scene: { object: { children: [ { name: 'B', userData } ] } } } );
	assert.strictEqual( hashWork( mesh( undefined ) ), hashWork( mesh( undefined ) ) );
	assert.strictEqual( hashWork( mesh( { descriptors: { v: 1 } } ) ), hashWork( mesh( undefined ) ) );
	assert.strictEqual( hashWork( mesh( { descriptors: { v: 1 }, label: 'x' } ) ), hashWork( mesh( { label: 'x' } ) ) );
	assert.notStrictEqual( hashWork( mesh( { label: 'x' } ) ), hashWork( mesh( { label: 'y' } ) ) );

} );

test( 'sourceKey identifies repo + file + branch (+ commit pin), else "local"', () => {

	assert.strictEqual( sourceKey( null ), 'local' );
	assert.strictEqual( sourceKey( { repo: '' } ), 'local' );
	assert.strictEqual( sourceKey( { repo: 'Me/Shorts', branch: 'main', file: 'x.json' } ), 'git:me/shorts@main:x.json' );
	assert.strictEqual( sourceKey( { repo: 'me/shorts' } ), 'git:me/shorts@main:scene.json' );
	assert.notStrictEqual( sourceKey( { repo: 'me/s', branch: 'a', file: 'x' } ), sourceKey( { repo: 'me/s', branch: 'b', file: 'x' } ) );
	assert.strictEqual( sourceKey( { repo: 'me/s', branch: 'a', file: 'x', commit: ' abc ' } ), 'git:me/s@a:x#abc' );
	assert.strictEqual( sourceLabel( 'git:me/s@main:x.json' ), 'me/s · x.json' );
	assert.strictEqual( sourceLabel( 'local' ), 'local scene' );

} );

test( 'dirty tracker: clean until the hash moves off the baseline', () => {

	const t = createDirtyTracker();
	assert.strictEqual( t.isDirty(), false );

	t.setBaseline( 'A' );
	assert.strictEqual( t.isDirty(), false );
	assert.deepStrictEqual( t.observe( 'A' ), { dirty: false, changed: false } );
	assert.deepStrictEqual( t.observe( 'B' ), { dirty: true, changed: true } );
	assert.deepStrictEqual( t.observe( 'C' ), { dirty: true, changed: false } );

} );

test( 'dirty tracker: undo back to the clean snapshot clears dirty', () => {

	const t = createDirtyTracker();
	t.setBaseline( 'A' );
	t.observe( 'B' );
	assert.deepStrictEqual( t.observe( 'A' ), { dirty: false, changed: true } );

} );

test( 'dirty tracker: the first observation becomes the baseline when nothing was loaded', () => {

	const t = createDirtyTracker();
	assert.deepStrictEqual( t.observe( 'X' ), { dirty: false, changed: false } );
	assert.strictEqual( t.baseline, 'X' );
	assert.strictEqual( t.observe( 'Y' ).dirty, true );

} );

test( 'dirty tracker: markClean (save/commit) adopts the current state; restore keeps the old baseline', () => {

	const t = createDirtyTracker();
	t.setBaseline( 'A' );
	t.observe( 'B' );
	t.markClean();
	assert.strictEqual( t.isDirty(), false );
	assert.strictEqual( t.observe( 'A' ).dirty, true ); // the old snapshot is now the changed one

	const r = createDirtyTracker();
	r.restore( 'A', 'B' );
	assert.strictEqual( r.isDirty(), true );

} );

test( 'decideRecovery: only unsaved work that differs from what loaded is offered', () => {

	const dirty = { state: {}, hash: 'B', baseHash: 'A', savedAt: 5 };
	assert.deepStrictEqual( decideRecovery( dirty, 'A' ), { action: 'prompt', savedAt: 5 } );
	assert.strictEqual( decideRecovery( undefined, 'A' ).action, 'none' );
	assert.strictEqual( decideRecovery( { ...dirty, state: undefined }, 'A' ).action, 'none' );
	assert.strictEqual( decideRecovery( { ...dirty, hash: 'A' }, 'A' ).reason, 'clean' );
	assert.strictEqual( decideRecovery( dirty, 'B' ).reason, 'identical' );

} );

test( 'wouldClobberUnsaved: protects another lineage\'s dirty autosave, never our own', () => {

	const dirty = { hash: 'B', baseHash: 'A', lineage: 'tab1' };
	assert.strictEqual( wouldClobberUnsaved( dirty, 'tab2', 'C' ), true );
	assert.strictEqual( wouldClobberUnsaved( dirty, 'tab1', 'C' ), false );
	assert.strictEqual( wouldClobberUnsaved( dirty, 'tab2', 'B' ), false );
	assert.strictEqual( wouldClobberUnsaved( { ...dirty, hash: 'A' }, 'tab2', 'C' ), false );
	assert.strictEqual( wouldClobberUnsaved( undefined, 'tab2', 'C' ), false );

} );

test( 'relativeTime wording', () => {

	const now = 1e12;
	assert.strictEqual( relativeTime( now - 3000, now ), 'just now' );
	assert.strictEqual( relativeTime( now + 5000, now ), 'just now' );
	assert.strictEqual( relativeTime( now - 42000, now ), '42 seconds ago' );
	assert.strictEqual( relativeTime( now - 60000, now ), '1 minute ago' );
	assert.strictEqual( relativeTime( now - 5 * 60000, now ), '5 minutes ago' );
	assert.strictEqual( relativeTime( now - 3600e3, now ), '1 hour ago' );
	assert.strictEqual( relativeTime( now - 3 * 3600e3 - 1000, now ), '3 hours ago' );
	assert.strictEqual( relativeTime( now - 2 * 86400e3, now ), '2 days ago' );
	assert.strictEqual( recoverPromptText( now - 5 * 60000, '', now ), 'Recover unsaved changes from 5 minutes ago?' );
	assert.strictEqual( recoverPromptText( now - 5 * 60000, 'me/s · x.json', now ), 'Recover unsaved changes from 5 minutes ago (me/s · x.json)?' );

} );

const obj = ( uuid, extra = {}, children = [] ) => ( { uuid, type: 'Mesh', name: uuid, ...extra, children } );
const scene = ( children, extra = {} ) => ( { scene: { object: { uuid: 's', type: 'Scene', userData: extra.userData || {}, children }, materials: extra.materials || [] }, scripts: {}, backgroundType: 'Default', environmentType: 'Default' } );

test( 'describeChanges names what differs, and nothing when the scenes match', () => {

	const base = scene( [ obj( 'a' ), obj( 'b', {}, [ obj( 'c' ) ] ) ] );
	assert.deepStrictEqual( describeChanges( base, JSON.parse( JSON.stringify( base ) ) ), [] );

	const edited = scene( [ obj( 'a', { name: 'renamed' } ), obj( 'b', {}, [ obj( 'c', { visible: false } ), obj( 'd' ) ] ) ] );
	assert.deepStrictEqual( describeChanges( base, edited ), [ '2 objects edited', '1 object added' ] );
	assert.deepStrictEqual( describeChanges( edited, base ), [ '2 objects edited', '1 object removed' ] );

} );

test( 'describeChanges reports the timeline, subtitles and materials', () => {

	const base = scene( [ obj( 'a' ) ], { materials: [ { uuid: 'm', color: 1 } ], userData: { timeline: { duration: 5 } } } );
	const next = scene( [ obj( 'a' ) ], { materials: [ { uuid: 'm', color: 2 } ], userData: { timeline: { duration: 6 }, renderSubtitles: [ { text: 'hi' } ] } } );
	assert.deepStrictEqual( describeChanges( base, next ), [ '1 material changed', 'timeline changed', 'subtitles changed' ] );

} );

test( 'describeChanges ignores derived descriptors and survives missing input', () => {

	const a = scene( [ obj( 'a', { userData: { label: 'x', descriptors: { v: 1 } } } ) ] );
	const b = scene( [ obj( 'a', { userData: { label: 'x', descriptors: { v: 2 } } } ) ] );
	assert.deepStrictEqual( describeChanges( a, b ), [] );
	assert.deepStrictEqual( describeChanges( null, b ), [] );

} );

test( 'sourceFile and recoverPrompt', () => {

	assert.strictEqual( sourceFile( 'git:me/repo@main:scenes/pyth.json#abc' ), 'pyth.json' );
	assert.strictEqual( sourceFile( 'local' ), '' );
	const now = 1e12;
	assert.strictEqual( recoverPrompt( { savedAt: now - 11 * 60000, file: 'pyth.json', changes: [ '3 objects edited', 'timeline changed' ], more: 2, now } ),
		'Recover unsaved changes to pyth.json from 11 minutes ago — 3 objects edited, timeline changed? 2 older copies are also saved.' );
	assert.strictEqual( recoverPrompt( { savedAt: now - 5 * 60000, now } ), 'Recover unsaved changes from 5 minutes ago?' );
	assert.strictEqual( recoverPrompt( { savedAt: now, file: 'a.json', more: 1, now } ), 'Recover unsaved changes to a.json from just now? 1 older copy is also saved.' );

} );

console.log( `\n${ pass } passed, ${ fail } failed` );
process.exit( fail ? 1 : 0 );
