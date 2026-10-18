// ── Sidebar.Customize.js ──────────────────────────────────────────────────────
// "Customize" tab: look / wardrobe / expression for any rigged GLB (MetaHuman-
// derived or otherwise). It customizes an existing character — it does not
// generate one. Every control builds an op from the closed, rig-safe customize
// set (customize/customizeOps.js) and runs it through one undoable command; the
// same ops are what a headless scene-spec `customize` stage replays.
//
// Rig-safety invariant: nothing here changes the vertex set, the skin weights or
// the skeleton, so the character still bakes and animates through bodyrig /
// facerig. Adding DEFORMABLE clothing is a rig step (skin it to the body), shown
// separately and flagged until done.

import { UIPanel, UIRow, UIText, UIButton, UISelect, UICheckbox, UIColor, UITextArea } from './libs/ui.js';

import { CustomizeCommand, SkinGarmentCommand } from './commands/CustomizeCommand.js';
import { CustomizeError, EXPRESSIONS, partMeshes, validateCustomize } from './customize/customizeOps.js';
import { auditRig, rigFingerprint } from './customize/rigSafety.js';
import { PRIMITIVE_KINDS } from './customize/props.js';
import { boneKey } from './presets/rigParts.js';
import { FaceChannel, gazeVerbs } from './intelligence/faceEdit.js';
import { holdTimelineAt } from './intelligence/timelineController.js';
import * as FT from './intelligence/faceTrack.js';

const SLIDERS = [
	{ label: 'Jaw open', shapes: [ 'jawOpen' ] },
	{ label: 'Smile', shapes: [ 'mouthSmileLeft', 'mouthSmileRight' ] },
	{ label: 'Frown', shapes: [ 'mouthFrownLeft', 'mouthFrownRight' ] },
	{ label: 'Brow up', shapes: [ 'browInnerUp' ] },
	{ label: 'Brow down', shapes: [ 'browDownLeft', 'browDownRight' ] },
	{ label: 'Blink', shapes: [ 'eyeBlinkLeft', 'eyeBlinkRight' ] },
	{ label: 'Eyes wide', shapes: [ 'eyeWideLeft', 'eyeWideRight' ] },
	{ label: 'Pucker', shapes: [ 'mouthPucker' ] },
	{ label: 'Cheek puff', shapes: [ 'cheekPuff' ] },
];

const BONES = [ 'head', 'neck_01', 'spine_03', 'clavicle_l', 'clavicle_r', 'hand_l', 'hand_r', 'foot_l', 'foot_r', 'pelvis' ];
const PROPS = [ 'sunglasses', ...PRIMITIVE_KINDS ];

const hex = n => '#' + n.toString( 16 ).padStart( 6, '0' );

function SidebarCustomize( editor ) {

	const signals = editor.signals;
	const container = new UIPanel();
	container.setPadding( '10px' );

	let root = null;

	// ── Small layout helpers ──────────────────────────────────────────────────

	const note = ( text, color ) => {

		const t = new UIText( text );
		t.dom.style.cssText = `display:block;font-size:11px;line-height:1.45;margin:0 0 8px;${ color ? 'color:' + color + ';' : 'opacity:0.7;' }`;
		return t;

	};

	const title = text => {

		const row = new UIRow();
		row.dom.style.marginTop = '14px';
		row.add( new UIText( text ).setFontWeight( 'bold' ) );
		container.add( row );

	};

	const row = ( label, ...controls ) => {

		const r = new UIRow();
		r.add( new UIText( label ).setClass( 'Label' ) );
		controls.forEach( c => r.add( c ) );
		container.add( r );
		return r;

	};

	const button = ( text, fn ) => {

		const b = new UIButton( text );
		b.dom.style.cssText = 'padding:4px 10px;border-radius:4px;margin-left:6px;';
		b.onClick( fn );
		return b;

	};

	// ── Header ────────────────────────────────────────────────────────────────

	container.add( new UIText( 'Character customizer' ).setFontWeight( 'bold' ) );
	container.add( note( 'Look, wardrobe and expression for any rigged GLB (MetaHuman exports and others). It customizes an existing character; it does not generate one. Every change is rig-safe: no vertex, skin-weight or skeleton edits, so the character still bakes and animates unchanged.' ) );

	const characterSelect = new UISelect().setWidth( '170px' );
	row( 'Character', characterSelect );

	const rigStatus = note( '' );
	const status = note( '' );
	container.add( rigStatus );
	container.add( status );

	function say( text, kind ) {

		status.dom.textContent = text;
		status.dom.style.color = kind === 'error' ? '#e5604d' : kind === 'ok' ? '#5cc16a' : '';
		status.dom.style.opacity = kind ? '1' : '0.7';

	}

	// ── Running ops ───────────────────────────────────────────────────────────

	function run( ops, name ) {

		if ( ! root ) return say( 'Pick a character first.', 'error' );

		try {

			const cmd = new CustomizeCommand( editor, root, ops, name );
			editor.execute( cmd );
			const r = cmd.result;
			say( `${ name }: ${ r.applied.map( a => `${ a.op } ×${ a.matched }` ).join( ', ' ) }. Rig unchanged (${ r.rig.all }).`, 'ok' );
			refreshAll();
			showRig( r.rig.all );

		} catch ( e ) {

			say( e instanceof CustomizeError ? e.message : 'Customize failed: ' + e.message, 'error' );
			console.error( e );

		}

	}

	// ── Look ──────────────────────────────────────────────────────────────────

	title( 'Look' );

	const skinColor = new UIColor().setHexValue( 0x9a6f57 );
	row( 'Skin tint', skinColor, button( 'Apply', () => run( [ { op: 'tint', target: 'part:skin', color: hex( skinColor.getHexValue() ) } ], 'Skin tint' ) ) );
	container.add( note( 'Multiplies into the skin texture, so detail is kept.' ) );

	const cardChecks = {};

	for ( const [ key, label ] of [ [ 'hair', 'Hair' ], [ 'beard', 'Facial hair' ], [ 'brows', 'Eyebrows' ] ] ) {

		const check = new UICheckbox( true );
		check.onChange( () => run( [ { op: check.getValue() ? 'show' : 'hide', target: 'part:' + key } ], label + ( check.getValue() ? ' shown' : ' hidden' ) ) );
		cardChecks[ key ] = check;
		row( label, check );

	}

	// ── Wardrobe ──────────────────────────────────────────────────────────────

	title( 'Wardrobe' );
	container.add( note( 'Recolors the clothing the character already has (flat colour). That is the cheapest and the rig-safe wardrobe; new garments are a rig step, below.' ) );

	const wardrobeRows = [];

	for ( const [ key, label, color ] of [ [ 'shirt', 'Top', 0x080808 ], [ 'bottom', 'Bottom', 0x080808 ], [ 'shoes', 'Shoes', 0x050505 ] ] ) {

		const picker = new UIColor().setHexValue( color );
		const r = row( label, picker, button( 'Recolor', () => run( [ { op: 'recolor', target: 'part:' + key, color: hex( picker.getHexValue() ) } ], label + ' recolor' ) ) );
		wardrobeRows.push( { key, row: r } );

	}

	// ── Expression ────────────────────────────────────────────────────────────

	title( 'Expression' );

	// Key at playhead: the same controls write KEYS on the timeline (the authored face) instead of a one-shot
	// edit — presets expand to explicit per-shape keys, a slider drag keys that shape. See guides/FACE_TRACK.md.
	const keyMode = new UICheckbox( false );
	const keyMs = document.createElement( 'input' );
	keyMs.type = 'number'; keyMs.min = 0; keyMs.step = 50; keyMs.value = 400; keyMs.style.width = '64px';
	const keyEase = new UISelect().setWidth( '96px' );
	keyEase.setOptions( Object.fromEntries( [ 'linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out' ].map( k => [ k, k ] ) ) );
	keyEase.setValue( 'ease-in-out' );

	const keyRow = row( 'Key at playhead', keyMode );
	keyRow.dom.appendChild( keyMs );
	keyRow.add( new UIText( 'ms' ).setClass( 'Label' ) );
	keyRow.add( keyEase );
	container.add( note( 'On: presets and sliders write timeline keys (arriving at the playhead) instead of a one-shot edit. Easing and duration carry the acting.' ) );

	const selectorOf = c => c.userData && c.userData.label ? '#' + c.userData.label : ( c.name ? '#' + c.name : c.uuid );
	const channel = () => new FaceChannel( editor, selectorOf( root ) );
	const playheadT = () => ( typeof editor.getTimelinePlayhead === 'function' ? Math.round( editor.getTimelinePlayhead() * 1000 ) / 1000 : 0 );
	const keySpec = () => ( { duration: Number( keyMs.value ) || 0, easing: keyEase.getValue() } );

	// one keyed edit: run it, show the result at the playhead, refresh the lists
	function keyed( label, fn ) {

		if ( ! root ) return say( 'Pick a character first.', 'error' );

		try {

			fn();
			holdTimelineAt( editor, playheadT() );
			editor.signals.sceneGraphChanged.dispatch();
			say( label, 'ok' );
			refreshFace();

		} catch ( e ) {

			say( e.message, 'error' );

		}

	}

	const presetSelect = new UISelect().setWidth( '110px' );
	presetSelect.setOptions( Object.fromEntries( Object.keys( EXPRESSIONS ).map( k => [ k, k ] ) ) );
	presetSelect.setValue( 'neutral' );
	row( 'Preset', presetSelect, button( 'Apply', () => {

		const name = presetSelect.getValue();
		if ( keyMode.getValue() ) return keyed( `Keyed "${ name }" at ${ playheadT() }s (explicit per-shape keys)`, () => channel().applyPreset( name, playheadT(), keySpec() ) );
		run( [ { op: 'blendshape', preset: name } ], 'Expression ' + name );

	} ) );

	const sliders = SLIDERS.map( s => {

		const input = document.createElement( 'input' );
		input.type = 'range';
		input.min = 0; input.max = 1; input.step = 0.05; input.value = 0;
		input.style.width = '150px';
		input.addEventListener( 'change', () => {

			const shapes = Object.fromEntries( s.shapes.map( n => [ n, Number( input.value ) ] ) );
			if ( keyMode.getValue() ) return keyed( `Keyed ${ s.label } ${ input.value } at ${ playheadT() }s`, () => channel().keyAt( playheadT(), { ...keySpec(), shapes } ) );
			run( [ { op: 'blendshape', shapes } ], s.label + ' ' + input.value );

		} );
		const r = new UIRow();
		r.add( new UIText( s.label ).setClass( 'Label' ) );
		r.dom.appendChild( input );
		container.add( r );
		return { ...s, input, row: r };

	} );

	// ── Face performance (gaze, idle, the keys) ───────────────────────────────

	title( 'Face performance' );
	container.add( note( 'Expression and gaze are keyed channels on the timeline — the same keys the shell writes with $S(\'#id\').face.keyAt(…) and .gaze(…). Gaze follows a named character as it moves; eyes lead and the head lags by the weight; past the eyes\' range the head turns.' ) );

	const gazeTarget = new UISelect().setWidth( '110px' );
	const gazeHead = document.createElement( 'input' );
	gazeHead.type = 'range'; gazeHead.min = 0; gazeHead.max = 1; gazeHead.step = 0.05; gazeHead.value = FT.GAZE_DEFAULTS.head; gazeHead.style.width = '70px';
	const gazeRow = row( 'Gaze at', gazeTarget );
	gazeRow.dom.appendChild( gazeHead );
	gazeRow.add( button( 'Key at playhead', () => keyed( `Gaze → ${ gazeTarget.getValue() } at ${ playheadT() }s`, () => gazeVerbs.gazeAt( editor, selectorOf( root ), playheadT(), gazeTarget.getValue(), { ...keySpec(), head: Number( gazeHead.value ) } ) ) ) );

	const idleCheck = new UICheckbox( false );
	const idleSeed = document.createElement( 'input' );
	idleSeed.type = 'number'; idleSeed.value = 1; idleSeed.step = 1; idleSeed.style.width = '56px';
	const idleRow = row( 'Idle layer', idleCheck );
	idleRow.add( new UIText( 'seed' ).setClass( 'Label' ) );
	idleRow.dom.appendChild( idleSeed );
	const applyIdle = () => keyed( idleCheck.getValue() ? 'Idle layer on (seeded blink, breath, gaze micro-noise)' : 'Idle layer off — authored keys untouched', () => channel().idle( idleCheck.getValue() ? { seed: Math.round( Number( idleSeed.value ) || 1 ) } : false ) );
	idleCheck.onChange( applyIdle );
	idleSeed.addEventListener( 'change', () => { if ( idleCheck.getValue() ) applyIdle(); } );
	container.add( note( 'Blinks, a faint breath and gaze micro-noise: seeded (same scene, same blinks), an underlayer that never becomes keys, and suppressed under a held beat.' ) );

	const keyList = document.createElement( 'div' );
	keyList.style.cssText = 'font-size:11px;line-height:1.7;margin:4px 0 8px;';
	container.dom.appendChild( keyList );

	const faceCmd = new UITextArea().setWidth( '100%' ).setHeight( '84px' );
	faceCmd.dom.readOnly = true;
	faceCmd.dom.style.cssText += 'font-family:monospace;font-size:11px;';
	container.add( faceCmd );

	function refreshFace() {

		keyList.innerHTML = '';
		if ( ! root ) { faceCmd.setValue( '' ); return; }

		const ch = channel(), sel = selectorOf( root );

		const others = characters().filter( c => c !== root ).map( selectorOf );
		const prev = gazeTarget.getValue();
		gazeTarget.setOptions( Object.fromEntries( [ ...others, 'away' ].map( o => [ o, o ] ) ) );
		gazeTarget.setValue( [ ...others, 'away' ].includes( prev ) ? prev : others[ 0 ] || 'away' );

		const cfg = ch.idleConfig();
		idleCheck.setValue( !! cfg );
		if ( cfg ) idleSeed.value = cfg.seed;

		const rowFor = ( k, text, remove ) => {

			const d = document.createElement( 'div' );
			d.textContent = `${ k.label }  ${ text }`;
			const x = document.createElement( 'button' );
			x.textContent = '×'; x.title = 'Delete this key';
			x.style.cssText = 'margin-left:8px;padding:0 6px;cursor:pointer;';
			x.addEventListener( 'click', () => keyed( 'Key deleted', remove ) );
			d.appendChild( x );
			keyList.appendChild( d );

		};

		for ( const k of ch.keys() ) rowFor( k, `${ Object.entries( k.shapes ).map( ( [ n, v ] ) => `${ n } ${ v }` ).join( ', ' ) } · ${ k.duration }ms ${ k.easing }${ k.hold ? ' · hold' : '' }`, () => ch.deleteKey( k.index ) );
		for ( const k of gazeVerbs.gazeKeys( editor, sel ) ) rowFor( k, `→ ${ Array.isArray( k.target ) ? 'point' : k.target } · head ${ k.head } · ${ k.duration }ms ${ k.easing }`, () => gazeVerbs.deleteGaze( editor, sel, k.index ) );

		faceCmd.setValue( ch.asCommand() );

	}

	signals.timelineChanged.add( () => { if ( root ) refreshFace(); } );

	// ── Props ─────────────────────────────────────────────────────────────────

	title( 'Rigid props' );
	container.add( note( 'Accessories are parented to a bone, so they follow it exactly and need no skinning. Re-attaching the same kind replaces it. Ctrl+Z removes it.' ) );

	const propSelect = new UISelect().setWidth( '110px' );
	propSelect.setOptions( Object.fromEntries( PROPS.map( p => [ p, p ] ) ) );
	propSelect.setValue( 'sunglasses' );
	const boneSelect = new UISelect().setWidth( '110px' );
	row( 'Prop', propSelect );
	row( 'Bone', boneSelect, button( 'Attach', () => {

		const kind = propSelect.getValue(), bone = boneSelect.getValue();
		const op = { op: 'attachProp', prop: { kind }, bone };
		if ( kind !== 'sunglasses' ) { op.prop.size = 0.12; op.prop.color = '#c9a227'; op.offset = [ 0, 0.15, 0 ]; }
		run( [ op ], 'Attach ' + kind + ' to ' + bone );

	} ) );

	// ── Rig step ──────────────────────────────────────────────────────────────

	title( 'Rig step: added clothing' );
	container.add( note( 'A new deformable garment (jacket, coat, dress) is NOT a customize op: it must be skinned to the body skeleton, or it z-fights, clips and stays static under animation. Select the garment mesh in the outliner (modelled at the rest pose), then:' ) );

	row( '', button( 'Skin selected garment to body', () => {

		const garment = editor.selected;
		if ( ! root ) return say( 'Pick a character first.', 'error' );
		if ( ! garment || ! garment.isMesh ) return say( 'Select a mesh in the outliner first.', 'error' );
		if ( garment.isSkinnedMesh ) return say( 'That mesh is already skinned.', 'error' );

		try {

			editor.execute( new SkinGarmentCommand( editor, root, garment ) );
			say( `Skinned "${ garment.name }" to the body. Re-bake with bodyrig / facerig before shipping.`, 'ok' );
			refreshAll();

		} catch ( e ) {

			say( e.message, 'error' );

		}

	} ) );
	row( '', button( 'Flag selected as garment', () => {

		const g = editor.selected;
		if ( ! g || ! g.isMesh ) return say( 'Select a mesh in the outliner first.', 'error' );
		g.userData.garment = true;
		say( `"${ g.name }" flagged as a garment: it is reported until it is skinned.`, 'ok' );
		refreshAll();

	} ) );

	const flags = new UIText( '' );
	flags.dom.style.cssText = 'display:block;font-size:11px;line-height:1.45;margin:6px 0;color:#e5a23d;white-space:pre-wrap;';
	container.add( flags );

	// ── Spec ──────────────────────────────────────────────────────────────────

	title( 'Spec' );
	container.add( note( 'The ops applied to this character, as a scene-spec customize stage. Paste one to replay it (it is validated first: geometry, skeleton and weight edits and bare clothing are refused).' ) );

	const specArea = new UITextArea().setWidth( '100%' ).setHeight( '150px' );
	specArea.dom.style.cssText += 'font-family:monospace;font-size:11px;';
	container.add( specArea );

	const specRow = new UIRow();
	specRow.add( button( 'Apply spec', () => {

		let spec;
		try { spec = JSON.parse( specArea.getValue() ); } catch ( e ) { return say( 'Not valid JSON: ' + e.message, 'error' ); }

		const check = validateCustomize( spec );
		if ( ! check.ok ) return say( check.errors.map( e => `[${ e.index }] ${ e.message }` ).join( '\n' ), 'error' );

		const stage = ( spec.customize !== undefined ? spec.customize : spec );
		const ops = Array.isArray( stage ) ? ( stage[ 0 ] && stage[ 0 ].ops ? stage[ 0 ].ops : stage ) : stage.ops;
		run( ops, 'Apply spec' );

	} ) );
	specRow.add( button( 'Copy', () => { navigator.clipboard && navigator.clipboard.writeText( specArea.getValue() ); say( 'Spec copied.', 'ok' ); } ) );
	specRow.add( button( 'Verify rig', verifyRig ) );
	container.add( specRow );

	container.add( note( 'Snapshot: Render tab. Commit: Git tab. The spec is saved in the scene with the character.' ) );

	// ── State sync ────────────────────────────────────────────────────────────

	const characters = () => editor.scene.children.filter( c => { let skinned = false; c.traverse( o => { if ( o.isSkinnedMesh ) skinned = true; } ); return skinned && ! c.userData.customizer; } );

	// Fingerprinting hashes every vertex and morph delta (slow on a MetaHuman), so it
	// only runs after a customize step (the result already carries it) or on demand.
	function showRig( now, loud ) {

		const baseline = root && root.userData.customize && root.userData.customize.rig;

		if ( ! baseline ) {

			rigStatus.dom.textContent = 'Rig: nothing customized yet.';
			rigStatus.dom.style.color = '';
			if ( loud ) say( 'Nothing customized yet, so there is no baseline to compare against.' );
			return;

		}

		if ( now === undefined ) {

			rigStatus.dom.textContent = `Rig baseline ${ baseline }. Press Verify rig to re-check it.`;
			rigStatus.dom.style.color = '';
			return;

		}

		const same = now === baseline;
		rigStatus.dom.textContent = same ? `Rig: unchanged since the first customization (${ now }).` : `Rig CHANGED since the first customization (${ baseline } → ${ now }): something edited geometry, weights or the skeleton. Re-bake before shipping.`;
		rigStatus.dom.style.color = same ? '#5cc16a' : '#e5604d';

	}

	function verifyRig() {

		if ( root ) showRig( rigFingerprint( root ).all, true );

	}

	function refreshFlags() {

		if ( ! root ) { flags.dom.textContent = ''; return; }
		const { flags: list } = auditRig( root );
		flags.dom.textContent = list.map( f => '⚠ ' + f.message ).join( '\n' );

	}

	function refreshControls() {

		if ( ! root ) return;

		for ( const [ key, check ] of Object.entries( cardChecks ) ) {

			const meshes = partMeshes( root, key );
			check.dom.disabled = meshes.length === 0;
			check.setValue( meshes.length === 0 || meshes.some( m => m.visible ) );

		}

		wardrobeRows.forEach( w => { w.row.dom.style.display = partMeshes( root, w.key ).length ? '' : 'none'; } );

		const morphMeshes = [];
		root.traverse( o => { if ( o.isMesh && o.morphTargetDictionary ) morphMeshes.push( o ); } );
		const has = name => morphMeshes.find( m => m.morphTargetDictionary[ name ] !== undefined );

		sliders.forEach( s => {

			const owner = has( s.shapes[ 0 ] );
			s.row.dom.style.display = owner ? '' : 'none';
			if ( owner ) s.input.value = owner.morphTargetInfluences[ owner.morphTargetDictionary[ s.shapes[ 0 ] ] ];

		} );

		const keys = new Set();
		root.traverse( o => { if ( o.isSkinnedMesh ) o.skeleton.bones.forEach( b => keys.add( boneKey( b.name ) ) ); } );
		const bones = BONES.filter( b => keys.has( b ) );
		const previous = boneSelect.getValue();
		boneSelect.setOptions( Object.fromEntries( ( bones.length ? bones : [ 'head' ] ).map( b => [ b, b ] ) ) );
		boneSelect.setValue( bones.includes( previous ) ? previous : bones[ 0 ] || 'head' );

		const record = root.userData.customize;
		if ( document.activeElement !== specArea.dom ) specArea.setValue( record ? JSON.stringify( { customize: [ { character: root.userData.label ? '#' + root.userData.label : undefined, ops: record.ops } ] }, null, 2 ) : '' );

	}

	function refreshAll() {

		refreshFace();
		refreshControls();
		showRig();
		refreshFlags();

	}

	function refreshCharacters() {

		const list = characters();
		const options = Object.fromEntries( list.map( c => [ c.uuid, c.name || 'character' ] ) );
		const previous = root && root.uuid;
		characterSelect.setOptions( options );

		root = list.find( c => c.uuid === previous ) || list[ 0 ] || null;
		if ( root ) characterSelect.setValue( root.uuid );
		if ( ! root ) { say( 'No rigged character in the scene. Import a rigged GLB first.' ); rigStatus.dom.textContent = ''; return; }

		refreshAll();

	}

	characterSelect.onChange( () => {

		root = characters().find( c => c.uuid === characterSelect.getValue() ) || null;
		refreshAll();

	} );

	let pending = null;
	const schedule = () => { clearTimeout( pending ); pending = setTimeout( refreshCharacters, 250 ); };
	signals.sceneGraphChanged.add( schedule );
	signals.editorCleared.add( schedule );
	refreshCharacters();

	return container;

}

export { SidebarCustomize };
