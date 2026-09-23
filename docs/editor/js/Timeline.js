import * as THREE from 'three';

import { UIPanel, UIText, UIButton, UISelect, UINumber, UICheckbox } from './libs/ui.js';
import { SetTimelineCommand } from './commands/SetTimelineCommand.js';
import { TimelineModel, TIMELINE_CLIP_NAME } from './intelligence/timeline.js';
import { holdTimelineAt, getTimelineTargetActions, refreshCameraProjections, activeRenderCameraAt } from './intelligence/timelineController.js';
import { OP_VOCABULARY } from './intelligence/opPrimitive.js';
import * as recipes from './intelligence/animationRecipes.js';
import { applyContentAt } from './intelligence/textChange.js';

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
	let followRenderCamera = true; // "Follow render camera" checkbox — viewport tracks the Camera Sequence during playback (default on)
	let followedAway = false;       // true once WE switched editor.viewportCamera away from editor.camera, so we know to restore it

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

	// Below the toolbar: the viewport can track whichever camera the Render
	// tab's Camera Sequence would be using at the current playhead time (or
	// editor.camera if no sequence is configured) while the timeline plays —
	// a live preview of what the export will actually look like.
	const followRow = document.createElement( 'div' );
	followRow.style.cssText = 'padding:2px 10px 6px;border-bottom:1px solid #ccc;display:flex;align-items:center;gap:6px;flex-shrink:0;';
	container.dom.appendChild( followRow );

	const followCheckbox = new UICheckbox( true );
	followCheckbox.dom.title = 'While playing, switch the viewport to whichever camera the Render tab\'s Camera Sequence is using right now (or the default camera if none is set)';
	followRow.appendChild( followCheckbox.dom );
	const followLabel = new UIText( 'Follow render camera' ).setFontSize( '11px' );
	followLabel.dom.style.cursor = 'pointer';
	followLabel.dom.addEventListener( 'click', () => {

		followCheckbox.setValue( ! followCheckbox.getValue() );
		followCheckbox.dom.dispatchEvent( new Event( 'change' ) );

	} );
	followRow.appendChild( followLabel.dom );
	followCheckbox.dom.addEventListener( 'change', function () {

		followRenderCamera = followCheckbox.getValue();
		if ( ! followRenderCamera ) restoreViewportCamera();

	} );

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

	// ── Code panel (compiled sugar, now editable, always visible) ─────────────
	// A Monaco editor (already loaded globally for Script.js) gives this JS
	// syntax highlighting. It loads asynchronously via requireJS, so `codePanel`
	// is a thin shim exposing the same value/style/addEventListener surface the
	// rest of this file already uses — writes before Monaco is ready are queued.
	const codePanelWrap = document.createElement( 'div' );
	codePanelWrap.style.cssText = 'position:relative;display:block;width:100%;box-sizing:border-box;height:160px;border:none;border-top:1px solid #ccc;resize:vertical;overflow:hidden;background:#1e1e1e;';
	container.dom.appendChild( codePanelWrap );

	let monacoCodeEditor = null;
	let pendingCode = '// timeline is empty';
	const codeFocusHandlers = [];
	const codeBlurHandlers = [];

	require( [ 'vs/editor/editor.main' ], function () {

		monacoCodeEditor = monaco.editor.create( codePanelWrap, {
			value: pendingCode,
			language: 'javascript',
			theme: 'vs-dark',
			minimap: { enabled: false },
			lineNumbers: 'on',
			fontSize: 11,
			fontFamily: 'Consolas, "Courier New", monospace',
			scrollBeyondLastLine: false,
			automaticLayout: true,
			wordWrap: 'on'
		} );

		monacoCodeEditor.onDidFocusEditorText( function () { for ( const fn of codeFocusHandlers ) fn(); } );
		monacoCodeEditor.onDidBlurEditorText( function () { for ( const fn of codeBlurHandlers ) fn(); } );

	} );

	const codePanel = {
		get value() { return monacoCodeEditor ? monacoCodeEditor.getValue() : pendingCode; },
		set value( v ) { pendingCode = v; if ( monacoCodeEditor ) monacoCodeEditor.setValue( v ); },
		style: codePanelWrap.style,
		addEventListener( type, fn ) {

			if ( type === 'focus' ) codeFocusHandlers.push( fn );
			else if ( type === 'blur' ) codeBlurHandlers.push( fn );

		}
	};

	// Save/Cancel icon buttons, pinned to the top-right corner of the editor
	// itself (appear only while the code panel is focused).
	const codeBtnContainer = document.createElement( 'div' );
	codeBtnContainer.style.cssText = 'display:none;gap:4px;flex-direction:row;align-items:center;position:absolute;top:6px;right:16px;z-index:6;';
	codePanelWrap.appendChild( codeBtnContainer );

	const saveIcon = '<svg width="13" height="13" viewBox="0 0 14 14"><path d="M2 7.5l3.5 3.5L12 3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
	const cancelIcon = '<svg width="13" height="13" viewBox="0 0 14 14"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

	const saveBtn = new UIButton();
	saveBtn.dom.innerHTML = saveIcon;
	saveBtn.dom.title = 'Save (apply the edited code)';
	saveBtn.dom.style.cssText = 'width:22px;height:22px;padding:0;border-radius:4px;display:flex;align-items:center;justify-content:center;background:#4CAF50;color:white;cursor:pointer;border:none;box-shadow:0 1px 3px rgba(0,0,0,0.4);';
	saveBtn.onClick( function () {

		const saved = parseAndApplyCode( codePanel.value );
		if ( ! saved ) return; // keep the panel open so the warning stays visible
		codeBtnContainer.style.display = 'none';

		// The save just recompiled the clip (syncTimeline holds+uncaches the OLD
		// actions), so `currentActions` are stale — resuming THEM would play the
		// pre-edit values, not what was just saved. Fetch fresh actions bound to
		// the new clip before resuming.
		if ( playing ) {

			currentActions = getTimelineTargetActions( editor );
			for ( const a of currentActions ) {

				a.setLoop( THREE.LoopOnce, 1 ); // never loop — see play()
				a.clampWhenFinished = true;
				a.play();

			}

		}

	} );
	codeBtnContainer.appendChild( saveBtn.dom );

	const cancelBtn = new UIButton();
	cancelBtn.dom.innerHTML = cancelIcon;
	cancelBtn.dom.title = 'Cancel (discard edits)';
	cancelBtn.dom.style.cssText = 'width:22px;height:22px;padding:0;border-radius:4px;display:flex;align-items:center;justify-content:center;background:#666;color:white;cursor:pointer;border:none;box-shadow:0 1px 3px rgba(0,0,0,0.4);';
	cancelBtn.onClick( function () {

		refreshCode(); // Revert to saved state
		clearCodeWarning();
		codeBtnContainer.style.display = 'none';
		if ( playing ) for ( const a of currentActions ) a.play(); // Resume animation (unchanged, no recompile happened)

	} );
	codeBtnContainer.appendChild( cancelBtn.dom );

	// Parse edited code and update timeline model. Returns true if the save
	// went through, false if it was aborted (see the empty-parse guard below).
	function parseAndApplyCode( codeText ) {

		if ( ! codeText.trim() ) return false;

		try {

			const model = editor.timeline ? TimelineModel.fromJSON( editor.timeline.toJSON() ) : new TimelineModel();
			model.tracks = []; // clear all events, rebuild from code
			let eventCount = 0;

			// Parse $S('selector').at(time).op(args).at(time).op(args); blocks
			const blocks = codeText.split( /\$S\(/ );
			for ( const block of blocks ) {

				if ( ! block.trim() ) continue;

				// Extract selector
				const selectorMatch = block.match( /^(['"`])(.+?)\1\)/ );
				if ( ! selectorMatch ) continue;
				const selector = selectorMatch[ 2 ];

				// Extract .at(time).op(args) chains with balanced paren/brace support
				const chainRegex = /\.at\(([^)]+)\)\.(\w+)\(/g;
				let m;
				while ( ( m = chainRegex.exec( block ) ) !== null ) {

					const at = parseFloat( m[ 1 ] );
					const op = m[ 2 ];
					if ( isNaN( at ) || ! op ) continue;

					// Extract balanced arguments starting after the opening paren
					const argsStart = m.index + m[ 0 ].length;
					let depth = 0;
					let argsEnd = argsStart;
					let foundEnd = false;

					for ( let i = argsStart; i < block.length; i ++ ) {

						const c = block[ i ];
						if ( c === '{' || c === '[' || c === '(' ) depth ++;
						else if ( c === '}' || c === ']' || c === ')' ) {

							if ( depth === 0 ) {

								argsEnd = i;
								foundEnd = true;
								break;

							}
							depth --;

						}

					}

					if ( ! foundEnd ) continue;
					const argsStr = block.substring( argsStart, argsEnd );

					// Parse args: handle animate(obj, dur) vs op(dur) vs op(obj)
					let args = {};
					let dur = 1;

					if ( argsStr.trim() ) {

						try {

							// Special case: animate(propsObj, duration)
							if ( op === 'animate' ) {

								// Find the comma that separates object from duration
								let commaDepth = 0;
								let commaIdx = - 1;
								for ( let i = 0; i < argsStr.length; i ++ ) {

									const c = argsStr[ i ];
									if ( c === '{' || c === '[' ) commaDepth ++;
									else if ( c === '}' || c === ']' ) commaDepth --;
									else if ( c === ',' && commaDepth === 0 ) {

										commaIdx = i;
										break;

									}

								}

								if ( commaIdx !== - 1 ) {

									// We have object, duration
									const objStr = argsStr.substring( 0, commaIdx ).trim();
									const durStr = argsStr.substring( commaIdx + 1 ).trim();
									// objStr already includes its own { }, evaluate as-is (don't re-wrap)
									const propsObj = Function( `"use strict"; return (${ objStr })` )();
									args = { props: propsObj };  // Wrap in props field to match model structure
									// Surface grammar is ms (jQuery-style); model stores seconds
									dur = ( parseFloat( durStr ) || 400 ) / 1000;

								} else {

									// Just object, no duration — already includes its own { }
									const propsObj = Function( `"use strict"; return (${ argsStr })` )();
									args = { props: propsObj };  // Wrap in props field
									dur = 0.4; // matches animateRecipe's default

								}

							} else if ( op === 'change' ) {

								// change('text') or change('text', { transition:'fade', dur:ms })
								const strMatch = argsStr.match( /^\s*(['"`])((?:\\.|(?!\1).)*)\1\s*/ );
								if ( ! strMatch ) throw new Error( 'change() expects a quoted string as its first argument' );

								const text = strMatch[ 2 ].replace( /\\(['"`\\])/g, '$1' );
								const rest = argsStr.slice( strMatch[ 0 ].length ).replace( /^,\s*/, '' ).trim();

								args = { text };
								dur = 0;

								if ( rest ) {

									const opts = Function( `"use strict"; return (${ rest })` )();
									if ( opts.transition === 'fade' ) args.transition = 'fade';
									dur = ( parseFloat( opts.dur ) || 0 ) / 1000;

								}

							} else if ( op === 'moveTo' || op === 'moveToEach' ) {

								// moveTo('#target', 600) / moveToEach('#targetSet .cell', 800)
								const strMatch = argsStr.match( /^\s*(['"`])((?:\\.|(?!\1).)*)\1\s*/ );
								if ( ! strMatch ) throw new Error( `${ op }() expects a quoted selector as its first argument` );

								const target = strMatch[ 2 ].replace( /\\(['"`\\])/g, '$1' );
								const rest = argsStr.slice( strMatch[ 0 ].length ).replace( /^,\s*/, '' ).trim();

								args = { target };
								dur = 0.4; // matches moveToRecipe's default

								if ( rest ) {

									const ms = parseFloat( rest );
									if ( ! isNaN( ms ) ) dur = ms / 1000;

								}

							} else {
								// Other ops: try numeric first, then object
								// One time unit everywhere: ms at the surface (matches .animate())
								const numVal = parseFloat( argsStr );
								if ( ! isNaN( numVal ) && argsStr.trim() === String( numVal ) ) {

									dur = numVal / 1000;

								} else {

									// Try as object (e.g., scale(1, 'x') or other args)
									const argObj = Function( `"use strict"; return ({${ argsStr }})` )();
									args = argObj;
									if ( argObj.duration !== undefined ) {

										dur = argObj.duration / 1000;
										delete args.duration;

									}

								}

							}

						} catch ( e ) {

							// If parsing fails, keep defaults (args={}, dur=1)

						}

					}

					model.addEvent( selector, { at, op, args, dur } );
					eventCount ++;

				}

			}

			if ( eventCount === 0 ) {

				// Nothing parsed — most likely a chain is missing .at(time) before
				// an op (required here since this is the ABSOLUTE timeline, unlike
				// the JS Shell's immediate $S().animate(...)). Abort rather than
				// saving an emptied-out model over the user's existing timeline.
				showCodeWarning( 'No events parsed — each op needs a preceding .at(time), e.g. .at(0).animate(...)' );
				return false;

			}

			clearCodeWarning();

			// Update timeline and save (directly with our built model)
			editor.execute( new SetTimelineCommand( editor, model.toJSON(), 'Edit code' ) );
			return true;

		} catch ( e ) {

			console.warn( 'Code parse error:', e.message );
			showCodeWarning( 'Code parse error: ' + e.message );
			return false;

		}

	}

	const codeWarning = document.createElement( 'div' );
	codeWarning.style.cssText = 'display:none;padding:4px 8px;font-size:10px;color:#ffb4b4;background:#3a1f1f;border-top:1px solid #ccc;';
	container.dom.insertBefore( codeWarning, codePanelWrap );

	function showCodeWarning( message ) {

		codeWarning.textContent = message;
		codeWarning.style.display = 'block';
		codePanel.style.borderColor = '#ff6b6b';

	}

	function clearCodeWarning() {

		codeWarning.style.display = 'none';
		codePanel.style.borderColor = '';

	}

	// Show Save/Cancel buttons and pause animation when code panel gets focus
	codePanel.addEventListener( 'focus', function () {

		codeBtnContainer.style.display = 'flex';
		// With many tracks + an open keyframe panel the editor can start out well
		// below the fold — bring it into view right away instead of relying on
		// the user to find/scroll the (separately scrollable) sidebar themselves.
		codePanelWrap.scrollIntoView( { block: 'nearest' } );
		// Pause animation while editing
		if ( currentActions.length ) for ( const a of currentActions ) a.paused = true;

	} );
	codePanel.addEventListener( 'blur', function () {

		// Don't hide buttons—they'll be hidden by Save/Cancel click handlers

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
	container.dom.insertBefore( keyPanel, codePanelWrap );

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
		const args = op === 'change' ? { text: '' } : {};
		commitMutation( m => m.addEvent( target, { at: Math.round( playhead * 1000 ) / 1000, op, args, dur } ), `Add ${ op }` );

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

					try {

						const action = editor.mixer.clipAction( c, editor.scene );
						actions.push( action );

					} catch ( e ) {

						console.warn( `Failed to create action for clip "${ c.name }":`, e.message );

					}

				}

			}
			
			clip = { duration: Math.max( 1, maxDuration ) };

		}

		if ( ! clip || ! ( clip.duration > 0 ) || actions.length === 0 ) return;
		
		for ( const a of actions ) {

			try {

				a.reset();
				// Play ONCE and hold the final frame — never loop back to the start.
				a.setLoop( THREE.LoopOnce, 1 );
				a.clampWhenFinished = true;
				a.enabled = true;
				a.paused = false;
				a.time = playhead % clip.duration;
				a.play();

			} catch ( e ) {

				console.warn( `Failed to play action:`, e.message );

			}

		}
		currentActions = actions;
		playing = true;

	}

	function pause() {

		if ( playing && currentActions.length ) {

			playhead = currentActions[ 0 ].time;
			playing = false;
			holdTimelineAt( editor, playhead ); // hold, don't stop — pose stays put
			restoreViewportCamera();
			updatePlayheadUI();

		}

	}

	function stop() {

		playing = false;
		playhead = 0;
		sampleAt( 0 ); // "Stop (rewind to 0)" — an explicit, user-initiated return to the base frame
		restoreViewportCamera();
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
		signals.timelinePlayheadUpdated.dispatch( { time: playhead, duration: dur, playing } );

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

		// change(text) for an instant cut; change(text, { transition:'fade', dur:ms }) for a cross-fade
		if ( op === 'change' ) {

			if ( args.transition === 'fade' ) {

				const ms = Math.round( ( dur ?? args.duration ?? 0 ) * 1000 );
				return `${ fmtVal( args.text ?? '' ) }, { transition: 'fade', dur: ${ ms } }`;

			}

			return fmtVal( args.text ?? '' );

		}

		// moveTo('#target', ms) — event-stored args are {target, duration}. Special-
		// cased because OP_VOCABULARY.moveTo describes the OTHER (instant, x/y/z)
		// overload of this same ChainableSet method — see opPrimitive.js.
		if ( op === 'moveTo' || op === 'moveToEach' ) {

			const ms = Math.round( ( dur ?? args.duration ?? 0 ) * 1000 );
			return `${ fmtVal( args.target ?? '' ) }, ${ ms }`;

		}

		const spec = OP_VOCABULARY[ op ] && OP_VOCABULARY[ op ].args ? OP_VOCABULARY[ op ].args : {};
		const parts = [];
		for ( const key of Object.keys( spec ) ) {

			let v = args[ key ];
			if ( key === 'duration' && ( v === undefined || v === null ) ) v = dur;
			if ( v === undefined || v === null ) continue;
			// One time unit everywhere: ms at the surface (matches .animate())
			if ( key === 'duration' ) v = Math.round( v * 1000 );
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

	// ── Follow render camera (viewport tracks the Camera Sequence while playing) ─
	function applyFollowCamera() {

		if ( ! followRenderCamera ) return;
		const cam = activeRenderCameraAt( editor, playhead );
		if ( cam && editor.viewportCamera !== cam ) {

			editor.viewportCamera = cam;
			followedAway = true;
			signals.viewportCameraChanged.dispatch();

		}

	}

	function restoreViewportCamera() {

		if ( followedAway && editor.viewportCamera !== editor.camera ) {

			editor.viewportCamera = editor.camera;
			signals.viewportCameraChanged.dispatch();

		}

		followedAway = false;

	}

	// ── rAF playhead read-out during playback ─────────────────────────────────
	let tickLastTime = null; // manual wall-clock fallback when there are no transform actions to drive playhead (a purely change()-based timeline)

	function tick() {

		const clip = getClip();

		if ( playing && clip && clip.duration > 0 ) {

			if ( currentActions.length ) {

				// LoopOnce + clampWhenFinished (see play()) holds .time at the
				// clip's duration and self-pauses once it gets there — no % wrap,
				// no loop back to the start.
				playhead = Math.min( currentActions[ 0 ].time, clip.duration );
				tickLastTime = null;
				if ( currentActions[ 0 ].paused ) playing = false; // reached the end on its own

			} else {

				const now = performance.now();
				if ( tickLastTime !== null ) playhead = Math.min( playhead + ( now - tickLastTime ) / 1000, clip.duration );
				tickLastTime = now;
				if ( playhead >= clip.duration ) playing = false; // reached the end — don't loop

			}

			updatePlayheadUI();

			// fov tracks write camera.fov but never the projection matrix
			refreshCameraProjections( editor );

			// content is a step function, not a keyframe track — sample separately
			applyContentAt( editor, editor.timeline, playhead );

			applyFollowCamera();

			// This tick() loop runs independently of Viewport's own animate()
			// loop, which only calls render() while mixer.stats.actions.inUse
			// is nonzero (plus one grace frame). The two loops can settle a
			// frame apart right as playback ends, freezing the canvas on
			// whatever mid-fade content state happened to be live when
			// Viewport's rendering stopped — never showing the truly-final
			// content this tick just computed. Flag it so Viewport's next
			// animate() forces one more render regardless of mixer state.
			editor.needsContentRender = true;

		} else {

			tickLastTime = null;

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
	signals.timelineChanged.add( function () { render(); refreshCode(); } );
	signals.editorCleared.add( function () { playing = false; playhead = 0; selectedEventId = null; render(); } );	signals.objectSelected.add( function () { selectedEventId = null; refreshKeyPanel(); } );
	signals.timelinePlayRequested.add( play ); // external trigger, e.g. the #...&play=true overlay button
	signals.timelinePauseRequested.add( pause ); // external trigger, e.g. Present mode's transport bar
	signals.timelineStopRequested.add( stop ); // external trigger, e.g. Present mode's transport bar
	signals.timelineSeekRequested.add( gotoTime ); // external trigger, e.g. Present mode's seek bar
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
	refreshCode();

	return container;

}

export { Timeline };
