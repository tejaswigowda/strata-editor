import * as THREE from 'three';

import { UIPanel, UIText, UIButton, UISelect } from './libs/ui.js';
import { SetTimelineCommand } from './commands/SetTimelineCommand.js';
import { TimelineModel, TIMELINE_CLIP_NAME } from './intelligence/timeline.js';
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
	let currentAction = null;
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
		'<code>$S(\'.a-cube\').fadeIn(1).then().spin(\'y\',1,2)</code><br>' +
		'or select an object and add an event at the playhead.';
	rows.appendChild( emptyHint );

	// ── Code panel (compiled sugar) ───────────────────────────────────────────
	const codePanel = document.createElement( 'textarea' );
	codePanel.readOnly = true;
	codePanel.spellcheck = false;
	codePanel.style.cssText = 'display:none;width:100%;box-sizing:border-box;height:120px;border:none;border-top:1px solid #ccc;font-family:monospace;font-size:11px;padding:8px;resize:vertical;background:#1e1e1e;color:#d4d4d4;';
	container.dom.appendChild( codePanel );

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
			return;

		}

		for ( const track of model.tracks ) {

			rows.appendChild( trackRow( track ) );

		}

		updatePlayheadUI();

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
		const a = editor.mixer.clipAction( clip, editor.scene );
		a.reset();
		a.enabled = true;
		a.play();
		a.time = Math.min( time, clip.duration );
		editor.mixer.update( 0 );
		a.stop(); // deactivate — objects hold the pose, stay editable
		currentAction = a;
		signals.sceneGraphChanged.dispatch();

	}

	function play() {

		const clip = getClip();
		if ( ! clip || ! ( clip.duration > 0 ) ) return;
		editor.mixer.stopAllAction();
		const a = editor.mixer.clipAction( clip, editor.scene );
		a.reset();
		a.enabled = true;
		a.paused = false;
		a.time = playhead % clip.duration;
		a.play();
		currentAction = a;
		playing = true;

	}

	function pause() {

		if ( playing && currentAction ) {

			playhead = currentAction.time;
			playing = false;
			sampleAt( playhead );
			updatePlayheadUI();

		}

	}

	function stop() {

		playing = false;
		editor.mixer.stopAllAction();
		playhead = 0;
		sampleAt( 0 );
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

	// ── Compiled-sugar codegen (shows the $S/.then() the timeline compiles from) ─
	function fmtVal( v ) {

		if ( typeof v === 'string' ) return `'${ v }'`;
		if ( Array.isArray( v ) ) return `[${ v.join( ', ' ) }]`;
		return String( v );

	}

	function argList( op, args, dur ) {

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
		if ( playing && currentAction && clip && clip.duration > 0 ) {

			playhead = currentAction.time % clip.duration;
			updatePlayheadUI();

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
	signals.editorCleared.add( function () { playing = false; playhead = 0; selectedEventId = null; render(); } );
	window.addEventListener( 'resize', render );

	render();

	return container;

}

export { Timeline };
