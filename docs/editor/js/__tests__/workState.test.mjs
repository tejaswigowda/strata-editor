// Node tests for the unsaved-work logic (hash, dirty tracker, recover decision, wording). Run with:
//   node docs/editor/js/__tests__/workState.test.mjs

import assert from 'node:assert';
import {
	hashString, workSnapshotString, hashWork, sourceKey, sourceLabel,
	createDirtyTracker, decideRecovery, wouldClobberUnsaved, relativeTime, recoverPromptText
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

console.log( `\n${ pass } passed, ${ fail } failed` );
process.exit( fail ? 1 : 0 );
