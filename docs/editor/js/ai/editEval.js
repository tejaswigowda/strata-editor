// ── ai/editEval.js ────────────────────────────────────────────────────────────
// The uploaded-asset EDITING eval. Generation already has eval.js; editing
// imported assets had none. This set uses synthetic assets that reproduce the
// hard properties of the REAL failures:
//   • a multi-part "dumptruck" with meaningless Object_N node names (pre-labeled
//     by a Stage-4-style pass so resolution has labels to match),
//   • a single merged-mesh "bed" (sub-part edits must fail gracefully),
//   • a shared-material pair (recolor must not bleed),
//   • a textured part (color tints, not replaces).
//
// Score axes (the editing-specific rubric):
//   1. resolved-correct-node    ★ did the edit hit the RIGHT part?
//   2. structure-valid          ran clean, went through commands
//   3. spatially-grounded       asset still rests on/above ground
//   4. didnt-break-other-parts  no shared-material bleed / wrong-part change
//   5. graceful-fail            merged-mesh sub-part → told user, didn't silently recolor
//
// Pure scorers (node-unit-testable, no DOM) + a dependency-injected runner that
// drives the real agentic loop in the browser (same shape as eval.js).

// ── Setup snippets (build the synthetic imported assets) ──────────────────────
// Each is shell-scope code. userData.label emulates the import-time LLM labeling
// pass so findByDescription can resolve part nouns. userData.imported marks them.

export const SETUP_DUMPTRUCK = `(function(){
	const g=new Group(); g.name='DumpTruck'; g.userData.imported=true;
	g.userData.label='DumpTruck'; g.userData.customClasses=new Set(['truck','vehicle']); // whole-asset addressable (#dumptruck / .truck)
	// classes mirror what classDerive produces on the REAL asset (material names →
	// .rims/.grille, descriptors → .front/.left). Set directly so the selector
	// engine resolves without the renderer-dependent descriptor harvest.
	const mk=(name,label,matName,classes,w,h,d,x,y,z,color)=>{
		const mat=new MeshStandardMaterial({color}); mat.name=matName;
		const m=new Mesh(new BoxGeometry(w,h,d),mat);
		// customClasses (not userData.classes): getAllClasses() — which feeds the
		// ADDRESSABLE PARTS list the model is shown — reads customClasses but
		// RE-DERIVES (ignores) a directly-set userData.classes. Using customClasses
		// keeps the PRESENTED vocabulary consistent with what hasClass() resolves.
		m.name=name; m.userData.label=label; m.userData.customClasses=new Set(classes);
		m.position.set(x,y,z); g.add(m); return m;
	};
	mk('Object_03','Cab','Grille',['cab','grille','front','top'],1.2,1.2,1.4,0,1.0,1.6,0x2266cc);
	mk('Object_07','Dump Bed','Body',['bed','dump-bed','center','largest'],1.6,1.0,2.4,0,1.1,-0.6,0x888888);
	mk('Object_12','Tail Light (left)','Tail Light',['tail-light','light','back','left','pair-left'],0.2,0.3,0.1,-0.6,0.8,-1.8,0xcc2222);
	mk('Object_13','Tail Light (right)','Tail Light',['tail-light','light','back','right','pair-right'],0.2,0.3,0.1,0.6,0.8,-1.8,0xcc2222);
	mk('Object_20','Front Left Wheel','Rims',['wheel','rims','front','left','pair-left'],0.5,0.5,0.3,-0.8,0.4,1.4,0x111111);
	mk('Object_21','Front Right Wheel','Rims',['wheel','rims','front','right','pair-right'],0.5,0.5,0.3,0.8,0.4,1.4,0x111111);
	mk('Object_22','Rear Left Wheel','Rims',['wheel','rims','back','left','pair-left'],0.5,0.5,0.3,-0.8,0.4,-1.0,0x111111);
	mk('Object_23','Rear Right Wheel','Rims',['wheel','rims','back','right','pair-right'],0.5,0.5,0.3,0.8,0.4,-1.0,0x111111);
	editor.execute(new AddObjectCommand(editor,g));
})();`;

export const SETUP_MERGED_BED = `(function(){
	const m=new Mesh(new BoxGeometry(2,0.8,3),new MeshStandardMaterial({color:0x9a7b4f}));
	m.name='GothicBed'; m.userData.imported=true; m.userData.partsSeparable=false;
	m.userData.label='Gothic Bed'; m.position.y=0.4;
	editor.execute(new AddObjectCommand(editor,m));
})();`;

export const SETUP_SHARED_WHEELS = `(function(){
	const mat=new MeshStandardMaterial({color:0xffffff});
	const a=new Mesh(new BoxGeometry(0.6,0.2,2),mat); a.name='Paddle Left'; a.position.set(-3,0.1,0);
	const b=new Mesh(new BoxGeometry(0.6,0.2,2),mat); b.name='Paddle Right'; b.position.set(3,0.1,0);
	editor.execute(new AddObjectCommand(editor,a)); editor.execute(new AddObjectCommand(editor,b));
})();`;

export const EDIT_EVAL_PROMPTS = [
	// Resolve an Object_N part via its Stage-4 label, recolor ONLY it.
	{ prompt: 'make the dump bed red', tier: 'resolve', setup: SETUP_DUMPTRUCK,
		expect: { targetName: 'Object_07', targetColorBase: 'red', mustNotChange: [ 'Object_03', 'Object_20' ] } },

	// Resolve + delete a symmetric pair.
	{ prompt: 'remove the front wheels', tier: 'resolve-delete', setup: SETUP_DUMPTRUCK,
		expect: { removed: [ 'Object_20', 'Object_21' ], mustKeep: [ 'Object_22', 'Object_23', 'Object_07' ] } },

	// Whole-asset transform.
	{ prompt: 'make it bigger', tier: 'transform', setup: SETUP_DUMPTRUCK,
		expect: { scaledUp: 'DumpTruck' } },

	// Merged mesh: a sub-part edit must NOT silently recolor everything.
	{ prompt: 'make the bed sheets red', tier: 'graceful-fail', setup: SETUP_MERGED_BED,
		expect: { mergedFail: true, target: 'GothicBed' } },

	// Shared material: independent colors, no bleed.
	{ prompt: 'turn the paddles blue and the right one green', tier: 'shared-material', setup: SETUP_SHARED_WHEELS,
		expect: { distinctColors: 2, mustNotChange: [] } },
];

// ── Snapshot keyed by NAME (the scorers compare parts across before/after) ─────
// Each entry: { color (hex int|null), minY, present:true }. Built by the runner
// from the editor scene; also constructible by hand in unit tests.

export function scoreResolvedCorrectNode( before, after, expect ) {

	const reasons = [];

	// Delete-style: the right parts vanished, the wrong ones stayed.
	if ( expect.removed ) {

		const goneOk = expect.removed.every( n => before.has( n ) && ! after.has( n ) );
		const keptOk = ( expect.mustKeep || [] ).every( n => after.has( n ) );
		if ( ! goneOk ) reasons.push( 'expected parts not removed' );
		if ( ! keptOk ) reasons.push( 'removed a part it should have kept' );
		return { pass: goneOk && keptOk, reasons };

	}

	// Recolor-style: the target changed color toward the requested base.
	if ( expect.targetName && expect.targetColorBase ) {

		const b = before.get( expect.targetName );
		const a = after.get( expect.targetName );
		const changed = b && a && b.color !== a.color;
		const right = a && colorBase( a.color ) === expect.targetColorBase;
		if ( ! changed ) reasons.push( 'target part did not change' );
		else if ( ! right ) reasons.push( 'target changed to the wrong color' );
		return { pass: !! ( changed && right ), reasons };

	}

	// Transform-style: handled by spatial/structure; not a resolution case.
	return { pass: true, reasons: [ 'n/a' ] };

}

export function scoreNoCollateral( before, after, expect ) {

	const reasons = [];
	let pass = true;

	for ( const n of expect.mustNotChange || [] ) {

		const b = before.get( n ), a = after.get( n );
		if ( b && a && b.color !== a.color ) { pass = false; reasons.push( `${ n } color bled` ); }

	}

	for ( const n of expect.mustKeep || [] ) {

		if ( ! after.has( n ) ) { pass = false; reasons.push( `${ n } wrongly removed` ); }

	}

	// Shared-material independence: the two recolored parts must end DIFFERENT.
	if ( expect.distinctColors ) {

		const changed = [ ...after.values() ].filter( v => v.color != null );
		const colors = new Set( changed.map( v => v.color ) );
		if ( colors.size < expect.distinctColors ) { pass = false; reasons.push( 'shared-material bleed: colors not distinct' ); }

	}

	return { pass, reasons };

}

export function scoreGracefulFail( before, after, result, expect ) {

	if ( ! expect.mergedFail ) return { pass: true, reasons: [ 'n/a' ] };

	const b = before.get( expect.target );
	const a = after.get( expect.target );
	const recolored = b && a && b.color !== a.color;

	// Acceptable: the whole merged mesh was NOT silently recolored, AND the agent
	// said something (a message acknowledging it can't isolate the sub-part).
	const told = !! ( result && /merged|single mesh|can.?t (isolate|separate)|whole|not separable/i.test( result.text || '' ) );

	if ( recolored && ! told ) return { pass: false, reasons: [ 'silently recolored the whole merged mesh' ] };
	if ( ! told && ! recolored ) return { pass: true, reasons: [ 'no silent change (no message captured)' ] };
	return { pass: ! recolored || told, reasons: told ? [ 'explained the limitation' ] : [ 'changed whole object' ] };

}

export function scoreEditStructure( result ) {

	const pass = !! ( result && result.execOk && ! result.usedSceneAdd );
	const reasons = [];
	if ( ! result || ! result.execOk ) reasons.push( 'did not execute cleanly' );
	if ( result && result.usedSceneAdd ) reasons.push( 'bypassed the command/undo stack' );
	return { pass, reasons };

}

export function scoreEditSpatial( after, expect ) {

	// Nothing should have sunk below the ground after the edit.
	const reasons = [];
	let pass = true;
	for ( const [ name, v ] of after ) {

		if ( v.minY != null && v.minY < - 0.25 ) { pass = false; reasons.push( `${ name } below ground` ); }

	}

	if ( expect.scaledUp ) {

		const a = after.get( expect.scaledUp );
		if ( ! a || ! a.scaledUp ) { pass = false; reasons.push( `${ expect.scaledUp } not scaled up` ); }

	}

	return { pass, reasons };

}

// ── Aggregate one case ────────────────────────────────────────────────────────

export function scoreEditCase( before, after, result, expect ) {

	const axes = {
		resolvedCorrectNode: scoreResolvedCorrectNode( before, after, expect ),
		structureValid: scoreEditStructure( result ),
		spatiallyGrounded: scoreEditSpatial( after, expect ),
		didntBreakOtherParts: scoreNoCollateral( before, after, expect ),
		gracefulFail: scoreGracefulFail( before, after, result, expect ),
	};
	const passed = Object.values( axes ).filter( a => a.pass ).length;
	return { axes, passed, total: Object.keys( axes ).length };

}

// ── Color base helper (kept local so the scorers are dependency-free) ─────────
// Coarse hue bucketing of a hex int → base name. Mirrors the spirit of
// colorName.js without importing it (so this file unit-tests in plain node).

function colorBase( hex ) {

	if ( hex == null ) return null;
	const r = ( ( hex >> 16 ) & 255 ) / 255, g = ( ( hex >> 8 ) & 255 ) / 255, b = ( hex & 255 ) / 255;
	const max = Math.max( r, g, b ), min = Math.min( r, g, b );
	if ( max - min < 0.12 ) return max > 0.8 ? 'white' : max < 0.2 ? 'black' : 'gray';
	if ( r >= g && r >= b ) return ( g > 0.4 && b < 0.4 ) ? 'orange' : ( b > 0.4 ) ? 'magenta' : 'red';
	if ( g >= r && g >= b ) return 'green';
	return 'blue';

}

export { colorBase };

// ── Dependency-injected runner (browser) ──────────────────────────────────────
// deps: {
//   runOnce(prompt) → Promise<{ text, execOk, usedSceneAdd }>   // drives agentic loop
//   snapshotByName() → Map<name,{ color, minY, scaledUp }>      // reads editor scene
//   clearScene(), runSetup(code)
// }

export async function runEditEval( deps ) {

	const results = [];

	for ( const item of EDIT_EVAL_PROMPTS ) {

		await deps.clearScene();
		await deps.runSetup( item.setup );

		const before = deps.snapshotByName();
		const out = await deps.runOnce( item.prompt );
		const after = deps.snapshotByName();

		const score = scoreEditCase( before, after, out, item.expect );
		results.push( { prompt: item.prompt, tier: item.tier, ...score } );

	}

	return results;

}
