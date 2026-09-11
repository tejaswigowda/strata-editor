import * as THREE from 'three';

import { UIPanel, UIText, UIButton, UISelect, UINumber } from './libs/ui.js';
import { SetTimelineCommand } from './commands/SetTimelineCommand.js';
import { TimelineModel, TIMELINE_CLIP_NAME } from './intelligence/timeline.js';
import { holdTimelineAt, getTimelineTargetActions, refreshCameraProjections } from './intelligence/timelineController.js';
import { OP_VOCABULARY } from './intelligence/opPrimitive.js';
import * as recipes from './intelligence/animationRecipes.js';

// ── Timeline.js ───────────────────────────────────────────────────────────────
// The Animations-tab REDO: the scene-wide UNIVERSAL TIMELINE editor. One absolute
// clock (editor.timeline), one row per track, event BLOCKS at their absolute `at`
// (width = `dur`), a single PLAYHEAD across all tracks. Play / pause / scrub drive
// the ONE clock; drag blocks to retime, drag the right edge to resize — every edit
// goes through SetTimelineCommand (undoable). A code panel shows the compiled
// $S/.then() sugar so the sugar and the absolute timeline stay in sync.

function Timeline( editor ) {

	const signals = editor.signals;

	const LABEL_W = 120;
	const MIN_VIEW = 4; // seconds — always show at least this span

	let playing = false;
	let currentActions = []; // the per-target actions driving active PLAY (empty while held/stopped)
	let playhead = 0;               // seconds (the shared clock)
	let selectedEventId = null;
	let showCode = false;

	// ── Container ─────────────────────────────────────────────────────────────
	const container = new UIPanel();
	container.setId( 'timeline' );
	container.dom.style.display = 'flex';
	container.dom.style.flexDirection = 'column';
	container.dom.style.borderBottom = '2px solid #999';

	// ── Toolbar ───────────────────────────────────────────────────────────────
	const bar = document.createElement( 'div' );
	bar.style.cssText = 'padding:6px 10px;border-bottom:1px solid #ccc;display:flex;align-items:center;gap:6px;flex-wrap:wrap;flex-shrink:0;';
	container.dom.appendChild( bar );

	const title = document.createElement( 'div' );
	title.textContent = 'Universal Timeline';
	title.style.cssText = 'font-weight:bold;font-size:11px;margin-right:6px;';
	bar.appendChild( title );

	const playIcon = '<svg width="12" height="12" viewBox="0 0 12 12"><path d="M3 1.5v9l7-4.5z" fill="currentColor"/></svg>';
	const pauseIcon = '<svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 1h3v10H2zM7 1h3v10H7z" fill="currentColor"/></svg>';
	const stopIcon = '<svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="2" width="8" height="8" fill="currentColor"/></svg>';

	function iconButton( html, title, onClick ) {

		const b = new UIButton();
		b.dom.innerHTML = html;
		b.dom.title = title;
		b.dom.style.cssText = 'width:24px;height:24px;padding:0;border-radius:4px;display:flex;align-items:center;justify-content:center;';
		b.onClick( onClick );
		bar.appendChild( b.dom );
		return b;

	}

	iconButton( playIcon, 'Play the timeline', play );
	iconButton( pauseIcon, 'Pause', pause );
	iconButton( stopIcon, 'Stop (rewind to 0)', stop );

	const timeReadout = document.createElement( 'div' );
	timeReadout.style.cssText = 'font-family:monospace;font-size:11px;background:rgba(0,0,0,0.05);border-radius:4px;padding:3px 8px;';
	timeReadout.textContent = '0.00 / 0.00';
	bar.appendChild( timeReadout );

	// Add-event-at-playhead: apply an animation to the SELECTED object at the
	// playhead (the "Key"-style action, but placing an absolute-time event).
	const addSelect = new UISelect().setWidth( '150px' );
	const presetOptions = { '': '+ Event at playhead' };
	for ( const op of Object.keys( OP_VOCABULARY ) ) {

		if ( OP_VOCABULARY[ op ].kind === 'anim' && typeof recipes[ op + 'Recipe' ] === 'function' ) presetOptions[ op ] = op;

	}
	addSelect.setOptions( presetOptions );
	addSelect.setValue( '' );
	addSelect.dom.title = 'Add a timed event on the selected object at the playhead';
	addSelect.onChange( function () {

		const op = addSelect.getValue();
		addSelect.setValue( '' );
		if ( op ) addEventAtPlayhead( op );

	} );
	bar.appendChild( addSelect.dom );

	const deleteButton = new UIButton( 'Delete' );
	deleteButton.dom.title = 'Delete the selected event (Del / Backspace)';
	deleteButton.dom.style.cssText = 'height:24px;padding:0 8px;border-radius:4px;font-size:11px;';
	deleteButton.dom.disabled = true;
	deleteButton.onClick( function () { deleteSelected(); } );
	bar.appendChild( deleteButton.dom );

	const codeButton = new UIButton( '</>' );
	codeButton.dom.title = 'Show the compiled $S/.then() sugar';
	codeButton.dom.style.cssText = 'height:24px;padding:0 8px;border-radius:4px;font-size:11px;';
	codeButton.onClick( function () {

		showCode = ! showCode;
		codePanel.style.display = showCode ? 'block' : 'none';
		if ( showCode ) refreshCode();

	} );
	bar.appendChild( codeButton.dom );

	// ── Timeline area (ruler + track rows + playhead) ─────────────────────────
	const area = document.createElement( 'div' );
	area.style.cssText = 'height:300px;display:flex;flex-direction:column;overflow:hidden;position:relative;';
	container.dom.appendChild( area );

	const ruler = document.createElement( 'div' );
	ruler.style.cssText = `height:20px;flex-shrink:0;position:relative;border-bottom:1px solid #ccc;margin-left:${ LABEL_W }px;background:rgba(0,0,0,0.03);overflow:hidden;`;
	area.appendChild( ruler );

	const rows = document.createElement( 'div' );
	rows.style.cssText = 'flex:1;overflow-y:auto;overflow-x:hidden;position:relative;';
	area.appendChild( rows );

	// Playhead line spans the rows region (below the ruler).
	const playheadEl = document.createElement( 'div' );
	playheadEl.style.cssText = `position:absolute;top:20px;bottom:0;width:2px;background:#f00;left:${ LABEL_W }px;pointer-events:none;z-index:20;`;
	area.appendChild( playheadEl );

	const emptyHint = document.createElement( 'div' );
	emptyHint.style.cssText = 'padding:18px 14px;color:#888;font-size:11px;line-height:1.6;';
	emptyHint.innerHTML = 'No timed events yet. Author with the sugar, e.g.<br>' +
		'<code>$S(\'.a-cube\').animate({ rotateY: 360 }, 2000, \'ease-in-out\')</code><br>' +
		'or select an object and add an event at the playhead.';
	rows.appendChild( emptyHint );

	// ── Code panel (compiled sugar, now editable) ──────────────────────────────
	const codePanel = document.createElement( 'textarea' );
	codePanel.spellcheck = false;
	codePanel.style.cssText = 'display:none;width:100%;box-sizing:border-box;height:120px;border:none;border-top:1px solid #ccc;font-family:monospace;font-size:11px;padding:8px;resize:vertical;background:#1e1e1e;color:#d4d4d4;';
	container.dom.appendChild( codePanel );

	// Parse edited code and update timeline model
	function parseAndApplyCode( codeText ) {

		if ( ! codeText.trim() || ! editor.timeline ) return;

		try {

			const model = TimelineModel.fromJSON( editor.timeline.toJSON() );
			model.tracks = []; // clear all events, rebuild from code

			// Parse $S('selector').at(time).op(args).at(time).op(args); blocks
			const blocks = codeText.split( /\$S\(/ );
			for ( const block of blocks ) {

				if ( ! block.trim() ) continue;

				// Extract selector
				const selectorMatch = block.match( /^(['"`])(.+?)\1\)/ );
				if ( ! selectorMatch ) continue;
				const selector = selectorMatch[ 2 ];

				// Extract .at(time).op(args) chains
				const chainMatches = block.matchAll( /\.at\(([^)]+)\)\.(\w+)\(([^)]*)\)/g );
				for ( const m of chainMatches ) {

					const at = parseFloat( m[ 1 ] );
					const op = m[ 2 ];
					const argsStr = m[ 3 ];

					if ( isNaN( at ) || ! op ) continue;

					// Parse args — for recipes with a single duration param (fade*, zoom*, slide*, etc),
					// extract it as a number. Otherwise try JSON object syntax.
					let args = {};
					let dur = 1;
					if ( argsStr.trim() ) {

						try {

							// First try: single numeric parameter (common for fade/zoom/slide recipes)
							const numVal = parseFloat( argsStr );
							if ( ! isNaN( numVal ) && argsStr.trim() === String( numVal ) ) {

								dur = numVal;

							} else {

								// Fall back to JSON object parsing
								const argObj = Function( `"use strict"; return ({${ argsStr }})` )();
								args = argObj;
								// Check if duration was in the object
								if ( argObj.duration !== undefined ) {
									dur = argObj.duration;
									delete args.duration; // Remove from args since it goes in dur field
								}

							}

						} catch ( e ) {

							// If parsing fails, keep defaults (args={}, dur=1)

						}

					}

					model.addEvent( selector, { at, op, args, dur } );

				}

			}

			// Update timeline and save (directly with our built model)
			editor.execute( new SetTimelineCommand( editor, model.toJSON(), 'Edit code' ) );
			
		// NOTE: Do NOT refresh code display here — let the user keep typing
		// without their edits being overwritten. Only refresh when code panel
		// is explicitly opened or when code comes from other sources (drag events).

	} catch ( e ) {

		console.warn( 'Code parse error:', e.message );

	}

}

// Debounce code changes to avoid rapid re-compiles
let codeTimeout;
codePanel.addEventListener( 'input', function () {

		clearTimeout( codeTimeout );
		codeTimeout = setTimeout( () => parseAndApplyCode( codePanel.value ), 500 );

	} );

	// ── Keyframe P/S/R editor (authors `animate` events on the ONE clock) ─────
	// Object mode: fields stage the target pose for the SELECTED OBJECT; "+ Key"
	// adds an `animate` event tweening from the previous key (or t=0) to the
	// staged pose, ARRIVING at the playhead. Key mode: an `animate` block is
	// selected — the fields edit THAT event (undoable via SetTimelineCommand).
	// Rotation defers to Look At (checkbox + target dropdown): the aim bakes to
	// rotation keyframes at compile time; the quaternion never surfaces.
	const keyPanel = document.createElement( 'div' );
	keyPanel.style.cssText = 'padding:6px 10px;border-top:1px solid #ccc;display:none;flex-direction:column;gap:4px;font-size:11px;flex-shrink:0;';
	container.dom.insertBefore( keyPanel, codePanel );

	const keyHeader = document.createElement( 'div' );
	keyHeader.style.cssText = 'display:flex;align-items:center;gap:8px;';
	keyPanel.appendChild( keyHeader );

	const keyTitle = document.createElement( 'span' );
	keyTitle.style.cssText = 'font-weight:bold;';
	keyHeader.appendChild( keyTitle );

	const keyButton = new UIButton( '+ Key @ playhead' );
	keyButton.dom.style.cssText = 'height:22px;padding:0 8px;border-radius:4px;font-size:11px;';
	keyButton.dom.title = 'Add an animate event tweening from the previous key to this pose, arriving at the playhead';
	keyButton.onClick( addKeyAtPlayhead );
	keyHeader.appendChild( keyButton.dom );

	const keyGrid = document.createElement( 'div' );
	keyGrid.style.cssText = 'display:grid;grid-template-columns:60px auto;gap:3px 6px;align-items:center;';
	keyPanel.appendChild( keyGrid );

	function keyLabel( text ) {

		const s = document.createElement( 'span' );
		s.style.cssText = 'color:#666;';
		s.textContent = text;
		keyGrid.appendChild( s );
		return s;

	}

	function keyFieldRow( fields ) {

		const wrap = document.createElement( 'div' );
		wrap.style.cssText = 'display:flex;gap:4px;align-items:center;';
		for ( const f of fields ) wrap.appendChild( f.dom );
		keyGrid.appendChild( wrap );
		return wrap;

	}

	function keyNum( unit ) {

		const n = new UINumber( 0 ).setPrecision( 3 ).setWidth( '48px' );
		if ( unit ) n.setUnit( unit );
		n.onChange( onKeyFieldChange );
		return n;

	}

	keyLabel( 'Position' );
	const kpX = keyNum(), kpY = keyNum(), kpZ = keyNum();
	keyFieldRow( [ kpX, kpY, kpZ ] );

	keyLabel( 'Rotation' );
	const krX = keyNum( '°' ), krY = keyNum( '°' ), krZ = keyNum( '°' );
	keyFieldRow( [ krX, krY, krZ ] );

	keyLabel( 'Look At' );
	const kLookAt = document.createElement( 'input' );
	kLookAt.type = 'checkbox';
	kLookAt.title = 'Defer the rotation to a target — the aim bakes to rotation keyframes';
	kLookAt.addEventListener( 'change', function () { syncLookAtLock(); onKeyFieldChange(); } );
	const kLookAtTarget = new UISelect().setWidth( '116px' );
	kLookAtTarget.onChange( onKeyFieldChange );
	const lookAtWrap = document.createElement( 'div' );
	lookAtWrap.style.cssText = 'display:flex;gap:6px;align-items:center;';
	lookAtWrap.appendChild( kLookAt );
	lookAtWrap.appendChild( kLookAtTarget.dom );
	keyGrid.appendChild( lookAtWrap );

	keyLabel( 'Scale' );
	const ksX = keyNum(), ksY = keyNum(), ksZ = keyNum();
	keyFieldRow( [ ksX, ksY, ksZ ] );

	function syncLookAtLock() {

		const locked = kLookAt.checked;
		for ( const f of [ krX, krY, krZ ] ) {

			f.dom.style.pointerEvents = locked ? 'none' : '';
			f.dom.style.opacity = locked ? '0.4' : '';

		}

	}

	function updateLookAtOptions( excludeObject ) {

		const options = {};
		editor.scene.traverse( child => {

			if ( child === editor.scene || child === excludeObject ) return;
			if ( child.isMesh || child.isGroup || child.isCamera || child.isLight ) options[ child.uuid ] = child.name || child.type;

		} );
		const prev = kLookAtTarget.getValue();
		kLookAtTarget.setOptions( options );
		if ( options[ prev ] !== undefined ) kLookAtTarget.setValue( prev );

	}

	function selectedAnimateEvent() {

		if ( ! selectedEventId || ! editor.timeline ) return null;
		const found = editor.timeline.findEvent( selectedEventId );
		return found && found.event.op === 'animate' ? found : null;

	}

	/** props for an animate event from the staged fields (full-pose key). */
	function buildPropsFromFields() {

		const props = { to: {
			position: [ kpX.getValue(), kpY.getValue(), kpZ.getValue() ],
			scale: [ ksX.getValue(), ksY.getValue(), ksZ.getValue() ],
		} };

		if ( kLookAt.checked ) {

			const target = editor.scene.getObjectByProperty( 'uuid', kLookAtTarget.getValue() );
			if ( target ) props.lookAt = bestSelectorFor( target );

		} else {

			props.to.rotation = [ krX.getValue(), krY.getValue(), krZ.getValue() ];

		}

		return props;

	}

	function fillFieldsFromProps( props ) {

		const to = ( props && props.to ) || {};
		if ( Array.isArray( to.position ) ) { kpX.setValue( to.position[ 0 ] ); kpY.setValue( to.position[ 1 ] ); kpZ.setValue( to.position[ 2 ] ); }
		if ( Array.isArray( to.scale ) ) { ksX.setValue( to.scale[ 0 ] ); ksY.setValue( to.scale[ 1 ] ); ksZ.setValue( to.scale[ 2 ] ); }
		if ( Array.isArray( to.rotation ) ) { krX.setValue( to.rotation[ 0 ] ); krY.setValue( to.rotation[ 1 ] ); krZ.setValue( to.rotation[ 2 ] ); }

		kLookAt.checked = !! ( props && props.lookAt );
		if ( props && typeof props.lookAt === 'string' ) {

			// resolve the stored selector ('#Name' or raw uuid) back to a dropdown value
			const name = props.lookAt.replace( /^#/, '' );
			let uuid = null;
			editor.scene.traverse( child => {

				if ( uuid ) return;
				if ( child.uuid === props.lookAt || child.name === name || ( child.userData && child.userData.label === name ) ) uuid = child.uuid;

			} );
			if ( uuid ) kLookAtTarget.setValue( uuid );

		}

		syncLookAtLock();

	}

	function fillFieldsFromObject( object ) {

		kpX.setValue( object.position.x ); kpY.setValue( object.position.y ); kpZ.setValue( object.position.z );
		krX.setValue( object.rotation.x * THREE.MathUtils.RAD2DEG );
		krY.setValue( object.rotation.y * THREE.MathUtils.RAD2DEG );
		krZ.setValue( object.rotation.z * THREE.MathUtils.RAD2DEG );
		ksX.setValue( object.scale.x ); ksY.setValue( object.scale.y ); ksZ.setValue( object.scale.z );
		syncLookAtLock();

	}

	/** Key mode: writing a field edits the SELECTED animate event (undoable). */
	function onKeyFieldChange() {

		const found = selectedAnimateEvent();
		if ( ! found ) return; // object mode: fields are just staged for + Key

		const id = found.event.id;
		const props = buildPropsFromFields();
		commitMutation( m => {

			const f = m.findEvent( id );
			if ( f ) f.event.args = { ...f.event.args, props };

		}, 'Edit key' );
		sampleAt( playhead ); // reflect the edit at the current playhead pose

	}

	function addKeyAtPlayhead() {

		const object = editor.selected;
		if ( ! object || object === editor.scene ) {

			keyTitle.textContent = 'Select an object first';
			return;

		}

		const target = bestSelectorFor( object );
		const props = buildPropsFromFields();

		// tween from the previous key on this track (or 0) so the pose ARRIVES
		// at the playhead — classic keyframing over the animate grammar
		let prevEnd = 0;
		const track = editor.timeline ? editor.timeline.track( target ) : null;
		if ( track ) for ( const e of track.events ) {

			const end = e.at + e.dur;
			if ( end <= playhead + 1e-6 ) prevEnd = Math.max( prevEnd, end );

		}

		const at = Math.round( Math.min( prevEnd, playhead ) * 1000 ) / 1000;
		const dur = Math.round( Math.max( 0.001, playhead - at ) * 1000 ) / 1000;
		commitMutation( m => m.addEvent( target, { at, op: 'animate', args: { props, easing: 'linear', duration: dur }, dur } ), 'Add key' );
		sampleAt( playhead );

	}

	function refreshKeyPanel() {

		const found = selectedAnimateEvent();
		const object = editor.selected;

		if ( found ) {

			keyPanel.style.display = 'flex';
			keyButton.dom.style.display = 'none';
			keyTitle.textContent = `Key: ${ found.track.target } @ ${ found.event.at.toFixed( 2 ) }s — edits apply to this event`;
			updateLookAtOptions( null );
			fillFieldsFromProps( found.event.args && found.event.args.props );

		} else if ( object && object !== editor.scene ) {

			keyPanel.style.display = 'flex';
			keyButton.dom.style.display = '';
			keyTitle.textContent = `Keyframe: ${ object.name || object.type }`;
			updateLookAtOptions( object );
			fillFieldsFromObject( object );

		} else {

			keyPanel.style.display = 'none';

		}

	}

	// ── Time <-> pixel mapping ────────────────────────────────────────────────
	function viewDuration() {

		return Math.max( MIN_VIEW, editor.timeline ? editor.timeline.duration : 0 );

	}

	function laneWidth() {

		return Math.max( 1, area.clientWidth - LABEL_W );

	}

	function timeToPx( t ) {

		return ( t / viewDuration() ) * laneWidth();

	}

	function pxToTime( px ) {

		return Math.max( 0, ( px / laneWidth() ) * viewDuration() );

	}

	// ── Rendering ─────────────────────────────────────────────────────────────
	function render() {

		const model = editor.timeline || new TimelineModel();

		// Ruler ticks (every 1s, or 0.5s when short).
		ruler.innerHTML = '';
		const vd = viewDuration();
		const step = vd <= 6 ? 0.5 : ( vd <= 20 ? 1 : Math.ceil( vd / 20 ) );
		for ( let t = 0; t <= vd + 1e-6; t += step ) {

			const tick = document.createElement( 'div' );
			tick.style.cssText = `position:absolute;left:${ timeToPx( t ) }px;top:0;bottom:0;border-left:1px solid #ddd;font-size:9px;color:#999;padding-left:2px;`;
			tick.textContent = ( Math.round( t * 100 ) / 100 ) + 's';
			ruler.appendChild( tick );

		}

		rows.innerHTML = '';

		if ( model.isEmpty() ) {

			rows.appendChild( emptyHint );
			updatePlayheadUI();
			refreshKeyPanel();
			return;

		}

		for ( const track of model.tracks ) {

			rows.appendChild( trackRow( track ) );

		}

		updatePlayheadUI();
		refreshKeyPanel();

	}

	function trackRow( track ) {

		const row = document.createElement( 'div' );
		row.style.cssText = 'display:flex;align-items:center;height:26px;border-bottom:1px solid #eee;';

		const label = document.createElement( 'div' );
		label.style.cssText = `width:${ LABEL_W }px;flex-shrink:0;box-sizing:border-box;padding:0 6px;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#555;`;
		label.textContent = track.target;
		label.title = track.target;
		row.appendChild( label );

		const lane = document.createElement( 'div' );
		lane.style.cssText = 'flex:1;height:100%;position:relative;background:rgba(0,0,0,0.02);';
		row.appendChild( lane );

		for ( const ev of track.events ) lane.appendChild( eventBlock( track, ev, lane ) );

		return row;

	}

	function eventBlock( track, ev, lane ) {

		const block = document.createElement( 'div' );
		const left = timeToPx( ev.at );
		const width = Math.max( 6, timeToPx( ev.dur ) );
		const selected = ev.id === selectedEventId;
		block.style.cssText = `position:absolute;left:${ left }px;width:${ width }px;top:4px;bottom:4px;` +
			`background:${ selected ? '#ff5722' : '#2196F3' };border-radius:3px;opacity:0.85;` +
			'cursor:grab;font-size:9px;color:#fff;overflow:hidden;white-space:nowrap;padding:2px 4px;box-sizing:border-box;user-select:none;';
		block.textContent = ev.op;
		block.title = `${ ev.op } @ ${ ev.at.toFixed( 2 ) }s, dur ${ ev.dur.toFixed( 2 ) }s — drag to retime, drag right edge to resize`;

		// Resize handle (right edge).
		const handle = document.createElement( 'div' );
		handle.style.cssText = 'position:absolute;right:0;top:0;bottom:0;width:6px;cursor:ew-resize;background:rgba(255,255,255,0.35);';
		block.appendChild( handle );

		// Drag to retime.
		block.addEventListener( 'mousedown', function ( e ) {

			if ( e.target === handle ) return;
			e.stopPropagation();
			e.preventDefault();
			selectedEventId = ev.id;
			render();

			const startX = e.clientX;
			const startAt = ev.at;
			let moved = false;

			function onMove( me ) {

				if ( Math.abs( me.clientX - startX ) > 2 ) moved = true;
				if ( ! moved ) return;
				const nextAt = Math.max( 0, startAt + ( ( me.clientX - startX ) / laneWidth() ) * viewDuration() );
				block.style.left = timeToPx( nextAt ) + 'px';

			}

			function onUp( ue ) {

				document.removeEventListener( 'mousemove', onMove );
				document.removeEventListener( 'mouseup', onUp );
				if ( moved ) {

					const nextAt = Math.max( 0, startAt + ( ( ue.clientX - startX ) / laneWidth() ) * viewDuration() );
					commitMutation( m => m.moveEvent( ev.id, Math.round( nextAt * 1000 ) / 1000 ), 'Retime event' );

				}

			}

			document.addEventListener( 'mousemove', onMove );
			document.addEventListener( 'mouseup', onUp );

		} );

		// Drag right edge to resize (dur).
		handle.addEventListener( 'mousedown', function ( e ) {

			e.stopPropagation();
			e.preventDefault();
			selectedEventId = ev.id;

			const startX = e.clientX;
			const startDur = ev.dur;

			function onMove( me ) {

				const nextDur = Math.max( 0, startDur + ( ( me.clientX - startX ) / laneWidth() ) * viewDuration() );
				block.style.width = Math.max( 6, timeToPx( nextDur ) ) + 'px';

			}

			function onUp( ue ) {

				document.removeEventListener( 'mousemove', onMove );
				document.removeEventListener( 'mouseup', onUp );
				const nextDur = Math.max( 0, startDur + ( ( ue.clientX - startX ) / laneWidth() ) * viewDuration() );
				commitMutation( m => m.resizeEvent( ev.id, Math.round( nextDur * 1000 ) / 1000 ), 'Resize event' );

			}

			document.addEventListener( 'mousemove', onMove );
			document.addEventListener( 'mouseup', onUp );

		} );

		return block;

	}

	// ── Command-backed mutations ──────────────────────────────────────────────
	function commitMutation( mutate, name ) {

		const model = TimelineModel.fromJSON( editor.timeline.toJSON() );
		mutate( model );
		editor.execute( new SetTimelineCommand( editor, model.toJSON(), name ) );

	}

	function bestSelectorFor( object ) {

		if ( object.userData && object.userData.label ) return '#' + object.userData.label;
		if ( object.name ) return '#' + object.name;
		return object.uuid; // compile has a raw-uuid fallback

	}

	function addEventAtPlayhead( op ) {

		const object = editor.selected;
		if ( ! object || object === editor.scene ) {

			alert( 'Select an object first, then add a timed event at the playhead.' );
			return;

		}

		const target = bestSelectorFor( object );
		const dur = 1;
		commitMutation( m => m.addEvent( target, { at: Math.round( playhead * 1000 ) / 1000, op, args: {}, dur } ), `Add ${ op }` );

	}

	function deleteSelected() {

		if ( ! selectedEventId ) return;
		const id = selectedEventId;
		selectedEventId = null;
		commitMutation( m => m.removeEvent( id ), 'Delete event' );

	}

	// ── Playback / scrubbing (the ONE clock) ──────────────────────────────────
	function getClip() {

		const anims = editor.scene.animations || [];
		return anims.find( c => c.userData && c.userData.isTimeline ) || anims.find( c => c.name === TIMELINE_CLIP_NAME ) || null;

	}

	function sampleAt( time ) {

		const clip = getClip();
		if ( ! clip || ! ( clip.duration > 0 ) ) return;
		holdTimelineAt( editor, time ); // paused, never stopped — no restoreOriginalState() snap-back
		signals.sceneGraphChanged.dispatch();

	}

	function play() {

		let actions = getTimelineTargetActions( editor );
		let clip = getClip();
		
		// Fallback: if no timeline clip found, play individual clips from scene.animations
		// This allows recipe animations (fade, fadeIn, etc.) to play even if not in timeline model
		if ( actions.length === 0 && ( editor.scene.animations || [] ).length > 0 ) {

			actions = [];
			const maxDuration = Math.max( 
				...(editor.scene.animations || []).map( c => c.duration || 0 )
			);
			
			for ( const c of ( editor.scene.animations || [] ) ) {

				if ( c && c.duration > 0 ) {

					const action = editor.mixer.clipAction( c, editor.scene );
					actions.push( action );

				}

			}
			
			clip = { duration: Math.max( 1, maxDuration ) };

		}

		if ( ! clip || ! ( clip.duration > 0 ) || actions.length === 0 ) return;
		
		for ( const a of actions ) {

			a.reset();
			a.enabled = true;
			a.paused = false;
			a.time = playhead % clip.duration;
			a.play();

		}
		currentActions = actions;
		playing = true;

	}

	function pause() {

		if ( playing && currentActions.length ) {

			playhead = currentActions[ 0 ].time;
			playing = false;
			holdTimelineAt( editor, playhead ); // hold, don't stop — pose stays put
			updatePlayheadUI();

		}

	}

	function stop() {

		playing = false;
		playhead = 0;
		sampleAt( 0 ); // "Stop (rewind to 0)" — an explicit, user-initiated return to the base frame
		updatePlayheadUI();

	}

	function gotoTime( t ) {

		playing = false;
		playhead = Math.max( 0, t );
		sampleAt( playhead );
		updatePlayheadUI();

	}

	// Scrub by dragging the ruler / rows region (moves the ONE clock).
	let scrubbing = false;

	function scrubFrom( clientX ) {

		const rect = area.getBoundingClientRect();
		const px = clientX - rect.left - LABEL_W;
		if ( px < 0 ) return;
		gotoTime( pxToTime( px ) );

	}

	ruler.addEventListener( 'mousedown', function ( e ) { scrubbing = true; scrubFrom( e.clientX ); } );
	rows.addEventListener( 'mousedown', function ( e ) {

		// Only scrub when clicking empty lane space (not an event block).
		if ( e.target === rows || e.target.style.background === 'rgba(0, 0, 0, 0.02)' ) { scrubbing = true; scrubFrom( e.clientX ); }

	} );
	document.addEventListener( 'mousemove', function ( e ) { if ( scrubbing ) scrubFrom( e.clientX ); } );
	document.addEventListener( 'mouseup', function () { scrubbing = false; } );

	function updatePlayheadUI() {

		const vd = viewDuration();
		playheadEl.style.left = ( LABEL_W + timeToPx( Math.min( playhead, vd ) ) ) + 'px';
		const dur = editor.timeline ? editor.timeline.duration : 0;
		timeReadout.textContent = `${ playhead.toFixed( 2 ) } / ${ dur.toFixed( 2 ) }`;
		deleteButton.dom.disabled = ! selectedEventId;

	}

	// ── Compiled-sugar codegen (shows the $S .animate()/.at() the timeline compiles from) ─
	function fmtVal( v ) {

		if ( typeof v === 'string' ) return `'${ v }'`;
		if ( Array.isArray( v ) ) return `[${ v.map( fmtVal ).join( ', ' ) }]`;
		if ( v && typeof v === 'object' ) return fmtProps( v );
		return String( v );

	}

	// object literal without quoted keys (reads like authored code)
	function fmtProps( obj ) {

		const inner = Object.keys( obj ).map( k => `${ k }: ${ fmtVal( obj[ k ] ) }` ).join( ', ' );
		return `{ ${ inner } }`;

	}

	function argList( op, args, dur ) {

		// The one grammar: .animate(props, ms, easing) — jQuery ms at the surface
		if ( op === 'animate' ) {

			const ms = Math.round( ( dur ?? args.duration ?? 0 ) * 1000 );
			const easing = args.easing && args.easing !== 'linear' ? `, '${ args.easing }'` : '';
			return `${ fmtProps( args.props || {} ) }, ${ ms }${ easing }`;

		}

		const spec = OP_VOCABULARY[ op ] && OP_VOCABULARY[ op ].args ? OP_VOCABULARY[ op ].args : {};
		const parts = [];
		for ( const key of Object.keys( spec ) ) {

			let v = args[ key ];
			if ( key === 'duration' && ( v === undefined || v === null ) ) v = dur;
			if ( v === undefined || v === null ) continue;
			parts.push( fmtVal( v ) );

		}

		return parts.join( ', ' );

	}

	function refreshCode() {

		const model = editor.timeline || new TimelineModel();
		if ( model.isEmpty() ) { codePanel.value = '// timeline is empty'; return; }

		const lines = [];
		for ( const track of model.tracks ) {

			const evs = model.sortedEvents( track );
			let line = `$S('${ track.target }')`;
			for ( const e of evs ) {

				line += `\n  .at(${ Math.round( e.at * 1000 ) / 1000 }).${ e.op }(${ argList( e.op, e.args, e.dur ) })`;

			}

			lines.push( line + ';' );

		}

		codePanel.value = lines.join( '\n\n' );

	}

	// ── rAF playhead read-out during playback ─────────────────────────────────
	function tick() {

		const clip = getClip();
		if ( playing && currentActions.length && clip && clip.duration > 0 ) {

			playhead = currentActions[ 0 ].time % clip.duration;
			updatePlayheadUI();

			// fov tracks write camera.fov but never the projection matrix
			refreshCameraProjections( editor );

		}

		requestAnimationFrame( tick );

	}

	tick();

	// Delete / Backspace removes the SELECTED EVENT (not the selected object).
	// Registered at the document in the CAPTURE phase so it runs before — and can
	// stop — the global object-delete shortcut (a bubble-phase document listener).
	// Only fires when an event is selected and the timeline panel is visible, and
	// never while typing in an input/textarea.
	document.addEventListener( 'keydown', function ( e ) {

		if ( e.key !== 'Delete' && e.key !== 'Backspace' ) return;
		if ( ! selectedEventId ) return;
		if ( container.dom.offsetParent === null ) return; // tab not visible
		const tag = e.target && e.target.tagName;
		if ( tag === 'INPUT' || tag === 'TEXTAREA' ) return;

		e.preventDefault();
		e.stopPropagation();
		deleteSelected();

	}, true );

	// ── Signals ───────────────────────────────────────────────────────────────
	signals.timelineChanged.add( function () { render(); if ( showCode ) refreshCode(); } );
	signals.editorCleared.add( function () { playing = false; playhead = 0; selectedEventId = null; render(); } );	signals.objectSelected.add( function () { selectedEventId = null; refreshKeyPanel(); } );
	signals.objectChanged.add( function ( object ) {

		// object mode only: keep the staged pose in sync with gizmo edits
		if ( object === editor.selected && ! selectedAnimateEvent() ) refreshKeyPanel();

	} );	window.addEventListener( 'resize', render );

	// The panel renders with laneWidth()=0 while its tab is hidden (ruler ticks
	// and event blocks collapse to zero width), and nothing re-renders on tab
	// switch. ResizeObserver fires when the panel gains size (display:none →
	// visible), so the first open of the Animations tab lays out correctly.
	new ResizeObserver( function () {

		if ( container.dom.offsetParent !== null ) render();

	} ).observe( area );

	render();

	return container;

}

export { Timeline };
