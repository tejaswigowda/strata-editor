import * as THREE from 'three';

import { UIPanel, UIText, UIButton, UISelect, UINumber, UICheckbox } from './libs/ui.js';
import { SetTimelineCommand } from './commands/SetTimelineCommand.js';
import { SetValueCommand } from './commands/SetValueCommand.js';
import { TimelineModel } from './intelligence/timeline.js';
import { cameraKeys } from './intelligence/splineTrack.js';
import { editCameraTrack, findCameraTrack, specFromEditCamera, moveSelector, optionsFor, simplifyAllCameras, simplifiableCameras, move as camMove } from './intelligence/cameraMoveEdit.js';
import { cameraSelectors } from './intelligence/cameraTracks.js';
import { tintAxes } from './AxisColors.js';
import { holdTimelineAt, getImportedClips, activeRenderCameraAt } from './intelligence/timelineController.js';
import { CLIP_OPS, importedClipsOf, clipRoot, nodesForTarget } from './intelligence/clipDirectives.js';
import { buildClipEvent } from './intelligence/clipControl.js';
import { cutCommand, groupCommand, setGroupEdl, makeMotion } from './intelligence/motionEditOps.js';
import { normalizeEdl, edlTable, edlDuration, formatCollisionReport } from './intelligence/motionEdit.js';
import { groupDomain } from './intelligence/motionEditRuntime.js';
import * as FT from './intelligence/faceTrack.js';
import { normalizeClassName } from './intelligence/classDerive.js';
import * as selectorEngine from './intelligence/selectorEngine.js';
import { OP_VOCABULARY } from './intelligence/opPrimitive.js';
import { formatClockMs } from './TimeFormat.js';
import { eventLineMap } from './intelligence/timelineCodeMap.js';
import { collapseCameraKeys, parseSetKeys, eventsFromSetKeys } from './intelligence/cameraKeysCode.js';
import * as view from './intelligence/timelineView.js';
import { registerSugarLanguage, SUGAR_LANGUAGE_ID } from './intelligence/sugarLanguage.js';
import * as recipes from './intelligence/animationRecipes.js';
import { applyContentAt } from './intelligence/textChange.js';
import * as ui from './intelligence/timelineUi.js';

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
	const ZOOM_STEP = 1.6; // per click of the zoom buttons
	const MIN_BLOCK_PX = 10; // a block is never drawn (or hit-tested) narrower than this
	const HANDLE_PX = 6; // the resize grip on a block's right edge
	const MIN_RESIZE_PX = 16; // narrower blocks have no grip: a click there selects instead of resizing
	const SNAP_PX = 6; // how close an edge must come to a target to snap to it
	const SNAP_GRID_KEY = 'strata.timeline.snapGrid'; // "1" while drags snap to the ruler's ticks (and the grid shows)
	const BAR_COLLAPSED_KEY = 'strata.timeline.toolbarCollapsed'; // "1" while the toolbar is one compact row

	let playing = false;
	let playhead = 0;               // seconds (the shared clock)
	editor.getTimelinePlayhead = () => playhead; // the shell's keyFromView() defaults to the playhead
	let selectedEventId = null;     // the primary selected event: the first of selectedIds (it owns the key options and the code line)
	let selectedIds = new Set();    // every selected event; shift / ctrl / cmd click builds it up
	let zoomSpan = null;            // seconds the lane shows; null = fit the whole timeline
	let viewStart = 0;              // seconds at the lane's left edge (always 0 when fitted)
	let followRenderCamera = true; // "Follow render camera" checkbox — viewport tracks the Camera Sequence during playback (default on)
	let followedAway = false;       // true once WE switched editor.viewportCamera away from editor.camera, so we know to restore it
	let followedCamera = null;      // the shot camera we last switched the viewport to (so a manual camera change isn't overridden)

	// ── Container ─────────────────────────────────────────────────────────────
	const container = new UIPanel();
	container.setId( 'timeline' );
	container.dom.style.display = 'flex';
	container.dom.style.flexDirection = 'column';
	// the tab fills the sidebar's height (css: #sidebar #animations): the track list and the code panel share what is left
	container.dom.style.boxSizing = 'border-box';
	container.dom.style.height = '100%';
	container.dom.style.minHeight = '0';
	container.dom.style.padding = '0';
	container.dom.style.border = '0';
	container.dom.style.overflowY = 'auto';
	container.dom.style.overflowX = 'hidden';

	// ── Toolbar: transport, edit actions, then follow + zoom ──────────────────
	const bar = document.createElement( 'div' );
	bar.style.cssText = 'padding:8px 10px 6px;border-bottom:1px solid #ccc;display:flex;flex-direction:column;gap:6px;flex-shrink:0;';
	container.dom.appendChild( bar );

	const ROW_CSS = 'display:flex;align-items:center;gap:6px;min-width:0;';
	const transportRow = document.createElement( 'div' );
	transportRow.style.cssText = ROW_CSS;
	const editRow = document.createElement( 'div' );
	editRow.style.cssText = ROW_CSS;
	const viewRow = document.createElement( 'div' );
	viewRow.style.cssText = ROW_CSS + 'justify-content:space-between;';
	bar.append( transportRow, editRow, viewRow );
	editRow.classList.add( 'timeline-hide-compact' ); // hidden while the toolbar is collapsed to its one row
	viewRow.classList.add( 'timeline-hide-compact' );

	const playIcon = '<svg width="14" height="14" viewBox="0 0 12 12"><path d="M3 1.5v9l7-4.5z" fill="currentColor"/></svg>';
	const pauseIcon = '<svg width="14" height="14" viewBox="0 0 12 12"><path d="M2 1h3v10H2zM7 1h3v10H7z" fill="currentColor"/></svg>';
	const stopIcon = '<svg width="14" height="14" viewBox="0 0 12 12"><rect x="2" y="2" width="8" height="8" fill="currentColor"/></svg>';

	function iconButton( html, title, onClick, color ) {

		const b = new UIButton();
		b.dom.innerHTML = html;
		b.dom.title = title;
		b.dom.style.cssText = `width:30px;height:30px;padding:0;border:none;border-radius:50%;background:${ color };color:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.35);cursor:pointer;display:flex;align-items:center;justify-content:center;`;
		b.onClick( onClick );
		transportRow.appendChild( b.dom );
		return b;

	}

	iconButton( playIcon, 'Play the timeline', play, '#2ea44f' );
	iconButton( pauseIcon, 'Pause', pause, '#e0a000' );
	iconButton( stopIcon, 'Stop (rewind to 0)', stop, '#e5484d' );

	// Previous / next key: the playhead jumps to the nearest block edge on the selected track (all tracks when none is selected)
	const prevKeyIcon = '<svg width="14" height="14" viewBox="0 0 12 12"><path d="M2 1.5v9" stroke="currentColor" stroke-width="1.5"/><path d="M10 1.5v9L4 6z" fill="currentColor"/></svg>';
	const nextKeyIcon = '<svg width="14" height="14" viewBox="0 0 12 12"><path d="M10 1.5v9" stroke="currentColor" stroke-width="1.5"/><path d="M2 1.5v9L8 6z" fill="currentColor"/></svg>';

	function keyNavButton( html, title, onClick ) {

		const b = document.createElement( 'button' );
		b.type = 'button';
		b.className = 'Button timeline-hide-compact';
		b.innerHTML = html;
		b.title = title;
		b.setAttribute( 'aria-label', title );
		b.style.cssText = 'width:26px;height:26px;padding:0;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;';
		b.addEventListener( 'click', onClick );
		transportRow.appendChild( b );
		return b;

	}

	keyNavButton( prevKeyIcon, 'Previous key: move the playhead to the previous block edge ( [ )', () => stepKey( - 1 ) );
	keyNavButton( nextKeyIcon, 'Next key: move the playhead to the next block edge ( ] )', () => stepKey( 1 ) );

	const timeReadout = document.createElement( 'div' );
	timeReadout.style.cssText = 'margin-left:4px;font-family:monospace;font-size:12px;background:rgba(0,0,0,0.06);border-radius:4px;padding:4px 10px;white-space:nowrap;';
	const timeCurrent = document.createElement( 'span' ); // the compact toolbar shows only this half
	const timeTotal = document.createElement( 'span' );
	timeTotal.className = 'timeline-hide-compact';
	timeCurrent.textContent = '00:00:000';
	timeTotal.textContent = ' / 00:00:000';
	timeReadout.append( timeCurrent, timeTotal );
	transportRow.appendChild( timeReadout );

	const chevronButton = document.createElement( 'button' );
	chevronButton.type = 'button';
	chevronButton.className = 'Button timeline-chevron';
	chevronButton.innerHTML = '<svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 7.5L6 4l3.5 3.5"/></svg>';
	chevronButton.style.cssText = 'margin-left:auto;width:24px;height:24px;padding:0;border-radius:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0;';
	chevronButton.addEventListener( 'click', () => setBarCollapsed( ! barCollapsed, true ) );
	transportRow.appendChild( chevronButton );

	// Add-event-at-playhead: apply an animation to the SELECTED object at the
	// playhead (the "Key"-style action, but placing an absolute-time event).
	const addSelect = new UISelect();
	addSelect.dom.style.cssText = 'flex:1;min-width:0;height:28px;padding:2px 4px;';
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
	editRow.appendChild( addSelect.dom );

	const trashIcon = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>';
	const deleteButton = new UIButton();
	deleteButton.dom.innerHTML = trashIcon;
	deleteButton.dom.title = 'Delete the selected events (Del / Backspace)';
	deleteButton.dom.setAttribute( 'aria-label', 'Delete the selected events' );
	deleteButton.dom.style.cssText = 'width:28px;height:28px;padding:0;border-radius:50%;display:flex;align-items:center;justify-content:center;';
	deleteButton.dom.disabled = true;
	deleteButton.onClick( function () { deleteSelected(); } );
	deleteButton.dom.style.flexShrink = '0';
	editRow.appendChild( deleteButton.dom );

	// Always in view, right of the delete button: a key at the playhead on the selected key's track, or on the selected object
	const addKeyButton = new UIButton( '+ Key' );
	addKeyButton.dom.title = 'Add a key at the playhead (on the selected key\'s track, or on the selected object): it arrives at the playhead';
	addKeyButton.dom.setAttribute( 'aria-label', 'Add a key at the playhead' );
	addKeyButton.dom.style.cssText = 'height:28px;padding:0 12px;border-radius:14px;display:flex;align-items:center;justify-content:center;white-space:nowrap;flex-shrink:0;';
	addKeyButton.dom.disabled = true;
	addKeyButton.onClick( function () { addKeyAtPlayhead(); } );
	editRow.appendChild( addKeyButton.dom );

	// Always in view: thin camera keys. Enabled while a camera has something to simplify; it opens the Simplify panel
	// for the selected key's camera (or the selected camera), else for the first camera with a dense move.
	const simplifyToolbarButton = new UIButton( 'Simplify' );
	simplifyToolbarButton.dom.title = 'Reduce camera keys: pick a tolerance, see "195 \u2192 27 keys", then apply (undoable). Works on the selected key\'s camera, or the first camera with a dense move';
	simplifyToolbarButton.dom.setAttribute( 'aria-label', 'Simplify camera keys' );
	simplifyToolbarButton.dom.style.cssText = 'height:28px;padding:0 12px;border-radius:14px;display:flex;align-items:center;justify-content:center;white-space:nowrap;flex-shrink:0;';
	simplifyToolbarButton.onClick( function () { openSimplify(); } );
	editRow.appendChild( simplifyToolbarButton.dom );
	// enabled when there is somewhere to put the key: a selected key (its track) or a selected object
	function updateAddKeyState() {

		const object = editor.selected;
		addKeyButton.dom.disabled = ! ( selectedAnimateEvent() || ( object && object !== editor.scene ) );

	}

	// Zoom the time axis: ctrl / cmd + wheel zooms around the cursor, these buttons around the playhead
	const zoomGroup = document.createElement( 'div' );
	zoomGroup.style.cssText = 'display:flex;align-items:center;gap:3px;flex-shrink:0;';

	function zoomButton( text, title, onClick ) {

		const b = document.createElement( 'button' );
		b.type = 'button';
		b.className = 'Button';
		b.textContent = text;
		b.title = title;
		b.setAttribute( 'aria-label', title );
		b.style.cssText = 'min-width:26px;height:26px;padding:0 8px;border-radius:13px;';
		b.addEventListener( 'click', onClick );
		zoomGroup.appendChild( b );
		return b;

	}

	zoomButton( '\u2212', 'Zoom out (ctrl / cmd + wheel)', () => zoomAt( 1 / ZOOM_STEP, null ) );
	const zoomReadout = document.createElement( 'span' );
	zoomReadout.style.cssText = 'min-width:32px;text-align:center;font-size:11px;font-family:monospace;';
	zoomReadout.textContent = '1\u00d7';
	zoomGroup.appendChild( zoomReadout );
	zoomButton( '+', 'Zoom in (ctrl / cmd + wheel)', () => zoomAt( ZOOM_STEP, null ) );
	zoomButton( 'Fit', 'Show the whole timeline', fitView );
	const fitButton = zoomGroup.lastChild;

	// Snap toggle: drags snap to whole ticks of the ruler (the grid shows faintly in the lanes); the playhead and other
	// blocks' edges still win when close, and Alt always moves freely
	const magnetIcon = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 3v9a7 7 0 0 0 14 0V3"/><path d="M5 7h4M15 7h4"/></svg>';
	let gridSnap = false;
	try { gridSnap = localStorage.getItem( SNAP_GRID_KEY ) === '1'; } catch ( e ) { /* storage blocked */ }
	const snapButton = document.createElement( 'button' );
	snapButton.type = 'button';
	snapButton.className = 'Button timeline-toggle';
	snapButton.innerHTML = magnetIcon;
	snapButton.style.cssText = 'width:26px;height:26px;padding:0;border-radius:13px;display:flex;align-items:center;justify-content:center;';
	snapButton.addEventListener( 'click', function () {

		gridSnap = ! gridSnap;
		try { localStorage.setItem( SNAP_GRID_KEY, gridSnap ? '1' : '0' ); } catch ( e ) { /* storage blocked */ }
		applySnapUI();

	} );
	zoomGroup.insertBefore( snapButton, zoomGroup.firstChild );

	// Below the toolbar: the viewport can track whichever camera the Render
	// tab's Camera Sequence would be using at the current playhead time (or
	// editor.camera if no sequence is configured) while the timeline plays —
	// a live preview of what the export will actually look like.
	const followRow = document.createElement( 'label' );
	followRow.style.cssText = 'display:flex;align-items:center;gap:5px;min-width:0;cursor:pointer;';
	viewRow.append( followRow, zoomGroup );

	const followCheckbox = new UICheckbox( true );
	followCheckbox.dom.title = 'While playing, switch the viewport to whichever camera the Render tab\'s Camera Sequence is using right now (or the default camera if none is set)';
	followRow.appendChild( followCheckbox.dom );
	const followLabel = new UIText( 'Follow render camera' ).setFontSize( '11px' );
	followRow.appendChild( followLabel.dom );
	followCheckbox.dom.addEventListener( 'change', function () {

		followRenderCamera = followCheckbox.getValue();
		if ( ! followRenderCamera ) restoreViewportCamera();

	} );

	// ── Collapsible toolbar ───────────────────────────────────────────────────
	// Collapsed: ONE compact row (transport, clock, delete, + Key, Fit, chevron). The other two rows are hidden and
	// the delete / + Key / Fit buttons move up into the transport row; the track list and the code panel regain the
	// freed height (they are flex items that share what the toolbar leaves).
	let barCollapsed = false;
	try { barCollapsed = localStorage.getItem( BAR_COLLAPSED_KEY ) === '1'; } catch ( e ) { /* storage blocked */ }

	function setBarCollapsed( on, persist ) {

		barCollapsed = on;
		bar.classList.toggle( 'timeline-bar-collapsed', on );
		if ( on ) for ( const el of [ deleteButton.dom, addKeyButton.dom, fitButton ] ) transportRow.insertBefore( el, chevronButton );
		else {

			editRow.append( deleteButton.dom, addKeyButton.dom, simplifyToolbarButton.dom );
			zoomGroup.appendChild( fitButton );

		}
		const label = on ? 'Expand the toolbar' : 'Collapse the toolbar to one row';
		chevronButton.title = label;
		chevronButton.setAttribute( 'aria-label', label );
		chevronButton.setAttribute( 'aria-expanded', String( ! on ) );
		if ( persist ) {

			try { localStorage.setItem( BAR_COLLAPSED_KEY, on ? '1' : '0' ); } catch ( e ) { /* storage blocked */ }
			render();
			requestAnimationFrame( positionKeyPopover ); // the blocks moved with the layout: re-anchor the key popover

		}

	}

	setBarCollapsed( barCollapsed, false );

	// ── Timeline area (ruler + track rows + playhead) ─────────────────────────
	// The mini-map (only while zoomed) sits just above the area, so the ruler's own geometry never changes.
	const miniMap = document.createElement( 'div' );
	miniMap.className = 'timeline-minimap';
	const miniLabel = document.createElement( 'div' );
	miniLabel.className = 'timeline-minimap-label';
	miniLabel.style.width = LABEL_W + 'px';
	miniLabel.textContent = 'Overview';
	const miniBar = document.createElement( 'div' );
	miniBar.className = 'timeline-minimap-bar';
	miniBar.tabIndex = 0;
	miniBar.setAttribute( 'role', 'slider' );
	miniBar.setAttribute( 'aria-label', 'Timeline overview: drag the window, or press the left / right arrow keys, to pan the zoomed view' );
	const miniBins = document.createElement( 'div' );
	miniBins.className = 'timeline-minimap-bins';
	const miniWindow = document.createElement( 'div' );
	miniWindow.className = 'timeline-minimap-window';
	const miniHead = document.createElement( 'div' );
	miniHead.className = 'timeline-minimap-head';
	miniBar.append( miniBins, miniWindow, miniHead );
	miniMap.append( miniLabel, miniBar );
	container.dom.appendChild( miniMap );

	const area = document.createElement( 'div' );
	area.style.cssText = 'flex:1 1 0;min-height:90px;display:flex;flex-direction:column;overflow:hidden;position:relative;';
	container.dom.appendChild( area );

	const ruler = document.createElement( 'div' );
	ruler.style.cssText = `height:20px;flex-shrink:0;position:relative;border-bottom:1px solid #ccc;margin-left:${ LABEL_W }px;background:rgba(0,0,0,0.03);overflow:hidden;`;
	area.appendChild( ruler );

	// the snap grid: one element over the lanes, drawn under the blocks (it comes before the rows in the tree)
	const gridEl = document.createElement( 'div' );
	gridEl.className = 'timeline-grid';
	gridEl.style.cssText = `top:20px;left:${ LABEL_W }px;right:0;`;
	area.appendChild( gridEl );

	const rows = document.createElement( 'div' );
	rows.style.cssText = 'flex:1;overflow-y:auto;overflow-x:hidden;position:relative;';
	area.appendChild( rows );

	// Playhead line spans the rows region (below the ruler).
	const playheadEl = document.createElement( 'div' );
	playheadEl.style.cssText = `position:absolute;top:20px;bottom:0;width:2px;background:#f00;left:${ LABEL_W }px;pointer-events:none;z-index:20;`;
	area.appendChild( playheadEl );

	// A thin guide shown while a block's edge is snapped to the playhead or another event's edge
	const snapGuide = document.createElement( 'div' );
	snapGuide.style.cssText = 'position:absolute;top:20px;bottom:0;width:1px;background:#00bcd4;display:none;pointer-events:none;z-index:19;';
	area.appendChild( snapGuide );

	// the blocks' look (a class each: the track list can hold ~1000) and the resize grip, which only shows while hovering a block wide enough to have one
	if ( ! document.getElementById( 'timeline-block-style' ) ) {

		const style = document.createElement( 'style' );
		style.id = 'timeline-block-style';
		style.textContent = '.timeline-block{position:absolute;top:4px;bottom:4px;background:#2196F3;border-radius:3px;opacity:0.85;cursor:grab;font-size:9px;color:#fff;overflow:hidden;white-space:nowrap;padding:2px 4px;box-sizing:border-box;user-select:none;}' +
			'.timeline-block.group{background:#00897b;}.timeline-block.face{background:#c2185b;}.timeline-block.gaze{background:#6d4c41;}' +
			'.timeline-block.selected{background:#ff5722;}' +
			'.timeline-block[data-resizable]:hover{box-shadow:inset -6px 0 0 rgba(255,255,255,0.45);}';
		document.head.appendChild( style );

	}

	const emptyHint = document.createElement( 'div' );
	emptyHint.style.cssText = 'padding:18px 14px;color:#888;font-size:11px;line-height:1.6;';
	emptyHint.innerHTML = 'No timed events yet. Author with the sugar, e.g.<br>' +
		'<code>$S(\'.a-cube\').animate({ rotateY: 360 }, 2000, \'ease-in-out\')</code><br>' +
		'or select an object and add an event at the playhead.';
	rows.appendChild( emptyHint );

	// ── Motion edit bar (performance groups: the cut, collision check, clear) ──
	// Drives the SAME $M operations the Shell exposes — one edit list, one undo stack.
	const $M = makeMotion( editor );
	const collisionText = {}; // group id -> last report text

	const motionBar = document.createElement( 'div' );
	motionBar.style.cssText = 'display:none;flex-direction:column;gap:6px;padding:6px 10px;border-top:1px solid #ccc;font-size:11px;flex-shrink:0;';
	container.dom.appendChild( motionBar );

	function motionButton( text, title, fn ) {

		const b = document.createElement( 'button' );
		b.textContent = text;
		b.title = title;
		b.style.cssText = 'padding:2px 8px;font-size:11px;border-radius:3px;cursor:pointer;';
		b.addEventListener( 'click', function () {

			try { fn(); } catch ( e ) { collisionText[ b.dataset.group ] = 'Error: ' + e.message; refreshMotionBar(); }

		} );
		return b;

	}

	function refreshMotionBar() {

		const model = editor.timeline;
		motionBar.innerHTML = '';

		if ( ! model || model.groups.length === 0 ) { motionBar.style.display = 'none'; return; }

		motionBar.style.display = 'flex';

		for ( const g of model.groups ) {

			const head = document.createElement( 'div' );
			head.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;';

			const cutLen = g.edl ? edlDuration( g.edl ) : null;
			const label = document.createElement( 'span' );
			label.style.cssText = 'flex:1;min-width:140px;';
			label.textContent = `${ g.broken ? '\u26A0' : '\u2702' } ${ g.id } (${ g.targets.join( ' + ' ) }) — ` +
				( g.edl ? `${ g.edl.spans.length } span${ g.edl.spans.length === 1 ? '' : 's' }, ${ cutLen.toFixed( 2 ) }s` : 'uncut' ) +
				( g.broken ? ' — registration BROKEN' : ' — registered' );
			head.appendChild( label );

			const check = motionButton( 'Collision check', 'Hip-to-hip floor distance over the edited timeline (floor 0.6 m)', () => {

				collisionText[ g.id ] = formatCollisionReport( $M( g.id ).collision() );
				refreshMotionBar();

			} );
			check.dataset.group = g.id;
			head.appendChild( check );

			if ( g.edl ) {

				const clear = motionButton( 'Clear cut', 'Drop the edit list — the full capture plays again (undoable)', () => { $M( g.id ).clear(); } );
				clear.dataset.group = g.id;
				head.appendChild( clear );

			}

			if ( g.broken ) {

				const restore = motionButton( 'Restore registration', 'Re-register the pair (undoable)', () => { $M( g.id ).restoreRegistration(); } );
				restore.dataset.group = g.id;
				head.appendChild( restore );

			}

			motionBar.appendChild( head );

			if ( collisionText[ g.id ] ) {

				const out = document.createElement( 'pre' );
				out.style.cssText = 'margin:0;font-size:10px;line-height:1.4;white-space:pre-wrap;color:#555;';
				out.textContent = collisionText[ g.id ];
				motionBar.appendChild( out );

			}

		}

	}

	// ── Code panel (compiled sugar, now editable, always visible) ─────────────
	// A Monaco editor (already loaded globally for Script.js) gives this JS
	// syntax highlighting. It loads asynchronously via requireJS, so `codePanel`
	// is a thin shim exposing the same value/style/addEventListener surface the
	// rest of this file already uses — writes before Monaco is ready are queued.
	const codePanelWrap = document.createElement( 'div' );
	codePanelWrap.style.cssText = 'position:relative;display:block;width:100%;box-sizing:border-box;flex:1 1 0;min-height:70px;border:none;overflow:hidden;background:#1e1e1e;';
	container.dom.appendChild( codePanelWrap );

	// ── Splitter: drag to trade height between the track list and the code panel ──
	// (the two share whatever the toolbar leaves; the ratio is remembered)
	const SPLIT_KEY = 'strata.timeline.split';
	const MIN_AREA_PX = 90, MIN_CODE_PX = 70;
	let split = 0.5;
	try { const saved = parseFloat( localStorage.getItem( SPLIT_KEY ) ); if ( saved > 0.1 && saved < 0.9 ) split = saved; } catch ( e ) { /* storage blocked */ }

	function applySplit() {

		area.style.flexGrow = String( split );
		codePanelWrap.style.flexGrow = String( 1 - split );
		try { localStorage.setItem( SPLIT_KEY, String( split ) ); } catch ( e ) { /* storage blocked */ }

	}

	const splitter = document.createElement( 'div' );
	splitter.id = 'timeline-splitter';
	splitter.setAttribute( 'role', 'separator' );
	splitter.setAttribute( 'aria-orientation', 'horizontal' );
	splitter.setAttribute( 'aria-label', 'Resize the timeline and the code panel (drag, or use the up / down arrow keys; double-click to reset)' );
	splitter.title = 'Drag to resize \u2022 double-click to reset';
	splitter.tabIndex = 0;
	container.dom.insertBefore( splitter, codePanelWrap );
	applySplit();

	function setSplitFromAreaHeight( px, total ) {

		const clamped = Math.min( Math.max( px, MIN_AREA_PX ), Math.max( MIN_AREA_PX, total - MIN_CODE_PX ) );
		split = Math.min( 0.9, Math.max( 0.1, clamped / total ) );
		applySplit();

	}

	splitter.addEventListener( 'pointerdown', function ( e ) {

		if ( e.button !== 0 ) return;
		e.preventDefault();
		splitter.setPointerCapture( e.pointerId );
		splitter.classList.add( 'dragging' );
		const startY = e.clientY, startArea = area.getBoundingClientRect().height;
		const total = startArea + codePanelWrap.getBoundingClientRect().height;

		function move( ev ) { setSplitFromAreaHeight( startArea + ev.clientY - startY, total ); }
		function up() {

			splitter.classList.remove( 'dragging' );
			splitter.removeEventListener( 'pointermove', move );
			splitter.removeEventListener( 'pointerup', up );
			splitter.removeEventListener( 'pointercancel', up );

		}
		splitter.addEventListener( 'pointermove', move );
		splitter.addEventListener( 'pointerup', up );
		splitter.addEventListener( 'pointercancel', up );

	} );
	splitter.addEventListener( 'dblclick', function () { split = 0.5; applySplit(); } );
	splitter.addEventListener( 'keydown', function ( e ) {

		if ( e.key !== 'ArrowUp' && e.key !== 'ArrowDown' ) return;
		e.preventDefault();
		const total = area.getBoundingClientRect().height + codePanelWrap.getBoundingClientRect().height;
		setSplitFromAreaHeight( area.getBoundingClientRect().height + ( e.key === 'ArrowDown' ? 24 : - 24 ), total );

	} );

	let monacoCodeEditor = null;
	let pendingCode = '// timeline is empty';
	const codeFocusHandlers = [];
	const codeBlurHandlers = [];

	require( [ 'vs/editor/editor.main' ], function () {

		registerSugarLanguage( monaco ); // highlighting without Monaco's TypeScript worker, which overflows its stack on long chains

		monacoCodeEditor = monaco.editor.create( codePanelWrap, {
			value: pendingCode,
			language: SUGAR_LANGUAGE_ID,
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
		monacoCodeEditor.onDidChangeCursorPosition( selectKeyAtCursor );
		revealKeyInCode( true ); // a key was selected before the editor finished loading

	} );

	// ── Key <-> code: the selection and the line being edited stay in sync ────
	// refreshCode() rebuilds `eventLines` (event id -> 1-based line) and `lineEvents` (the reverse).
	// Key -> code: selecting a key, in the timeline or on the camera path in the viewport, scrolls the
	// code panel to that line and highlights it; the editor is not focused (focus would pause playback
	// and open Save/Cancel).
	// Code -> key: moving the caret onto a key's line (click or arrow keys, not typing) selects that key,
	// which opens its options and brings its block into the track list. The code panel is left where it is.
	let eventLines = new Map();
	let lineEvents = new Map();
	let keyLineDecoration = [];
	let revealedKey = null; // what the panel is currently showing, so a re-render does not yank the scroll back

	function keyIdForCode() {

		if ( selectedEventId ) return selectedEventId;
		const path = editor.cameraPath;
		return path && path.selectedKeyId ? path.selectedKeyId : null;

	}

	function decorateKeyLine( line ) {

		if ( ! monacoCodeEditor ) return;
		keyLineDecoration = monacoCodeEditor.deltaDecorations( keyLineDecoration, line ? [ { range: new monaco.Range( line, 1, line, 1 ), options: { isWholeLine: true, className: 'timeline-key-line' } } ] : [] );

	}

	function revealKeyInCode( force ) {

		if ( ! monacoCodeEditor ) return;
		const id = keyIdForCode();
		const line = id ? eventLines.get( id ) : null;
		if ( ! line ) {

			if ( keyLineDecoration.length ) decorateKeyLine( 0 );
			revealedKey = null;
			return;

		}
		if ( ! force && revealedKey === id ) return;
		revealedKey = id;
		monacoCodeEditor.revealLineInCenter( line );
		decorateKeyLine( line );

	}

	function selectKeyAtCursor( e ) {

		// only a deliberate move by the user in the focused editor: not the reset a re-render does (setValue), nor typing
		if ( e.reason !== monaco.editor.CursorChangeReason.Explicit || ! monacoCodeEditor.hasTextFocus() ) return;
		const id = lineEvents.get( e.position.lineNumber );
		if ( ! id || ( id === selectedEventId && selectedIds.size === 1 ) ) return;

		revealedKey = id; // the editor is already on it: do not scroll it away from the caret
		decorateKeyLine( e.position.lineNumber );
		setSelection( [ id ] );
		panToEvent( id );

		// bring the key's block into the track list (the options are level with it)
		const block = keyBlockEl();
		if ( block ) {

			const br = block.getBoundingClientRect(), rr = rows.getBoundingClientRect();
			if ( br.top < rr.top ) rows.scrollTop -= rr.top - br.top;
			else if ( br.bottom > rr.bottom ) rows.scrollTop += br.bottom - rr.bottom;
			positionKeyPopover();

		}

	}

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

	} );
	codeBtnContainer.appendChild( cancelBtn.dom );

	// `.play('clip', { loop: true })` / `.pause('clip')` / `.stop('clip')` / `.seek(3.5, 'clip')`
	// argument text -> { clip, opts, time }. Throws a readable error on bad input.
	function parseClipCall( op, argsStr ) {

		const src = argsStr.trim();
		let list = [];

		if ( src ) {

			try {

				list = Function( `"use strict"; return [ ${ src } ]` )();

			} catch ( e ) {

				throw new Error( `${ op }(): could not read the arguments — ${ e.message }` );

			}

		}

		if ( op === 'seek' ) return { time: list[ 0 ], clip: list[ 1 ], opts: {} };

		if ( op === 'play' ) {

			if ( typeof list[ 0 ] === 'string' ) return { clip: list[ 0 ], opts: list[ 1 ] || {} };
			return { clip: undefined, opts: ( list[ 0 ] && typeof list[ 0 ] === 'object' ) ? list[ 0 ] : {} };

		}

		return { clip: list[ 0 ], opts: {} };

	}

	// `$M('id').at(t).cut([...spans], { blend, rootOffset, rootYaw })` and `.breakRegistration().timeOffset(sel, dt)`
	// lines of the code panel -> the group's edit list on `model`. Recorded against a stub so nothing
	// runs until it is validated; unsupported calls are an error, never silently dropped.
	function applyMotionLines( model, lines ) {

		for ( const line of lines ) {

			const recorded = [];
			const handle = ( id ) => {

				const calls = [];
				recorded.push( { id, calls } );
				const h = new Proxy( {}, { get: ( _, name ) => ( ...args ) => { calls.push( [ name, args ] ); return h; } } );
				return h;

			};

			handle.group = () => {}; // the definition line is informational — groups are created from the shell
			Function( '$M', `"use strict"; ${ line }` )( handle );

			for ( const { id, calls } of recorded ) {

				const g = model.group( id );
				if ( ! g ) throw new Error( `$M('${ id }'): no such performance group — create it with $M.group('${ id }', [...]) in the Shell` );

				for ( const [ name, args ] of calls ) {

					if ( name === 'at' ) {

						g.at = Math.max( 0, Number( args[ 0 ] ) || 0 );
						for ( const e of model.groupEvents( id ) ) e.at = g.at;

					} else if ( name === 'cut' ) {

						const opts = args[ 1 ] || {};
						const edl = normalizeEdl( { spans: args[ 0 ], blend: opts.blend, rootOffset: opts.rootOffset, rootYaw: opts.rootYaw }, groupDomain( editor, model, g ) );
						setGroupEdl( editor, model, g, edl );

					} else if ( name === 'breakRegistration' ) {

						g.broken = true;

					} else if ( name === 'timeOffset' || name === 'speedOf' ) {

						if ( ! g.broken ) throw new Error( `$M('${ id }').${ name }() needs .breakRegistration() first — it desynchronises the pair` );
						g.members = g.members || {};
						g.members[ args[ 0 ] ] = { ...( g.members[ args[ 0 ] ] || {} ), [ name === 'timeOffset' ? 'timeOffset' : 'speed' ]: Number( args[ 1 ] ) };

					} else {

						throw new Error( `$M('${ id }').${ name }(): not supported in the code panel — use the Shell` );

					}

				}

			}

		}

	}

	// Parse edited code and update timeline model. Returns true if the save
	// went through, false if it was aborted (see the empty-parse guard below).
	function parseAndApplyCode( codeText ) {

		if ( ! codeText.trim() ) return false;

		try {

			const model = editor.timeline ? TimelineModel.fromJSON( editor.timeline.toJSON() ) : new TimelineModel();

			// Performance-group events are owned by their `$M(...)` lines (below), not by `$S` lines:
			// keep them across the rebuild so a group's members can never be edited one at a time.
			const groupEvents = model.tracks.flatMap( t => t.events.filter( e => e.args && e.args.group ).map( e => ( { target: t.target, event: e } ) ) );
			const motionLines = [];
			codeText = codeText.split( '\n' ).filter( line => {

				if ( ! /^\s*\$M[.(]/.test( line ) ) return true;
				motionLines.push( line.trim() );
				return false;

			} ).join( '\n' );

			model.tracks = []; // clear all events, rebuild from code
			model.faces = {}; // the idle layer is rebuilt from its `.face.idle(...)` lines below
			let eventCount = 0;

			// Parse $S('selector').at(time).op(args).at(time).op(args); blocks
			const blocks = codeText.split( /\$S\(/ );
			for ( const block of blocks ) {

				if ( ! block.trim() ) continue;

				// Extract selector
				const selectorMatch = block.match( /^(['"`])(.+?)\1\)/ );
				if ( ! selectorMatch ) continue;
				const selector = selectorMatch[ 2 ];

				// `$S('#f1').face.idle({ seed: 7 })` — the face's idle layer (an underlayer, never keys)
				const afterSelector = block.slice( selectorMatch[ 0 ].length );

				if ( /^\s*\.face\.idle\(/.test( afterSelector ) ) {

					const from = afterSelector.indexOf( '.idle(' ) + 6;
					const idleArg = afterSelector.slice( from, afterSelector.lastIndexOf( ')' ) ).trim();
					const idle = FT.normalizeIdle( idleArg ? Function( `"use strict"; return (${ idleArg })` )() : true );
					if ( idle ) model.faces[ selector ] = { idle };
					continue;

				}

				// `$S('#cam').setKeys([{ t, pos, lookAt, fov }, ...], { smooth })` — a camera move refreshCode() collapsed
				// (cameraKeysCode.js); the same statement the shell takes. Anything chained after it is still read below.
				if ( /^\s*\.setKeys\(/.test( afterSelector ) ) {

					const { specs, opts } = parseSetKeys( afterSelector );
					const built = eventsFromSetKeys( selector, specs, opts );
					for ( const e of built.events ) model.addEvent( selector, e );
					if ( built.spline ) model.track( selector, true ).spline = true;
					eventCount += built.events.length;

				}

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

					// Imported-clip control (play/pause/stop/seek): validated against the real
					// clips here, OUTSIDE the lenient per-op try below, so a bad selector or
					// clip name surfaces as a code warning instead of a silently dropped event.
					if ( CLIP_OPS.has( op ) ) {

						const call = parseClipCall( op, argsStr );
						const built = buildClipEvent( editor, { selector, nodes: nodesForTarget( editor, selector ), op, clip: call.clip, opts: call.opts, time: call.time } );
						model.addEvent( selector, { at, op, args: built.args, dur: built.dur } );
						eventCount ++;
						continue;

					}

					// Authored face: `.at(start).face({ shapes, easing, duration, hold })` / `.gaze({ target, head, easing, duration })`.
					// Validated here with the SAME checks the shell uses, so a bad value is a code warning, not a silent drop.
					if ( op === FT.FACE_OP || op === FT.GAZE_OP ) {

						const o = Function( `"use strict"; return (${ argsStr.trim() || '{}' })` )();
						const { duration, ...rest } = o;
						if ( op === FT.FACE_OP ) FT.checkShapes( rest.shapes ); else FT.checkTarget( rest.target );
						model.addEvent( selector, { at, op, args: rest, dur: Math.max( 0, Number( duration ) || 0 ) / 1000 } );
						eventCount ++;
						continue;

					}

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

			for ( const { target, event } of groupEvents ) model.addEvent( target, event );
			eventCount += groupEvents.length;
			applyMotionLines( model, motionLines );

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
	container.dom.insertBefore( codeWarning, splitter );

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
		if ( playing ) pause();

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
	// With a key (an `animate` block) selected, this panel is a popover anchored to that block in the
	// timeline; with only an object selected there is no key to anchor to, so it stays inline above the
	// code panel (it stages the pose for "+ Key @ playhead").
	const KEY_INLINE_CSS = 'padding:6px 10px;border-top:1px solid #ccc;display:none;flex-direction:column;gap:4px;font-size:11px;flex-shrink:0;max-height:42%;overflow-y:auto;';
	const KEY_POPOVER_CSS = 'padding:8px 10px;display:flex;flex-direction:column;gap:4px;font-size:11px;max-height:min(66vh,520px);overflow:auto;';
	const keyPanel = document.createElement( 'div' );
	keyPanel.style.cssText = KEY_INLINE_CSS;
	container.dom.insertBefore( keyPanel, splitter );

	// the floating shell (appended to <body> so no scrolling parent clips it) with its arrow toward the key
	const KEY_POP_W = 272, KEY_POP_GAP = 12;
	const keyPop = document.createElement( 'div' );
	keyPop.className = 'timeline-key-popover';
	keyPop.setAttribute( 'role', 'dialog' );
	keyPop.setAttribute( 'aria-label', 'Keyframe options' );
	keyPop.style.cssText = `position:fixed;z-index:10000;display:none;box-sizing:border-box;width:${ KEY_POP_W }px;border:1px solid #888;border-radius:6px;box-shadow:0 6px 22px rgba(0,0,0,0.45);`;
	const keyArrow = document.createElement( 'div' );
	keyArrow.style.cssText = 'position:absolute;width:10px;height:10px;transform:rotate(45deg);box-sizing:border-box;pointer-events:none;';
	keyPop.appendChild( keyArrow );
	document.body.appendChild( keyPop );
	let keyPopoverOn = false;

	const keyHeader = document.createElement( 'div' );
	keyHeader.style.cssText = 'display:flex;align-items:center;gap:8px;';
	keyPanel.appendChild( keyHeader );

	const keyTitle = document.createElement( 'span' );
	keyTitle.style.cssText = 'font-weight:bold;flex:1;min-width:0;overflow-wrap:anywhere;';
	keyHeader.appendChild( keyTitle );

	const keyButton = new UIButton( '+ Key @ playhead' );
	keyButton.dom.style.cssText = 'height:22px;padding:0 8px;border-radius:4px;font-size:11px;';
	keyButton.dom.title = 'Add an animate event tweening from the previous key to this pose, arriving at the playhead';
	keyButton.onClick( addKeyAtPlayhead );
	keyHeader.appendChild( keyButton.dom );

	// With a key selected the add / delete buttons sit in a row under the title (the add button moves here from the header)
	const keyActions = document.createElement( 'div' );
	keyActions.style.cssText = 'display:none;gap:6px;align-items:center;flex-wrap:wrap;';
	const keyDeleteButton = new UIButton( 'Delete key' );
	keyDeleteButton.dom.style.cssText = 'height:22px;padding:0 8px;border-radius:4px;font-size:11px;';
	keyDeleteButton.dom.title = 'Delete the selected key (Del / Backspace)';
	keyDeleteButton.onClick( function () { deleteSelected(); } );
	keyActions.appendChild( keyDeleteButton.dom );

	const keyCodeLink = document.createElement( 'button' );
	keyCodeLink.type = 'button';
	keyCodeLink.title = 'Show this key in the code panel';
	keyCodeLink.style.cssText = 'height:20px;padding:0 6px;border:1px solid #888;border-radius:4px;background:transparent;color:inherit;font-size:10px;cursor:pointer;display:none;';
	keyCodeLink.addEventListener( 'click', function () { revealKeyInCode( true ); } );
	keyHeader.appendChild( keyCodeLink );

	const keyClose = document.createElement( 'button' );
	keyClose.type = 'button';
	keyClose.textContent = '\u00d7';
	keyClose.title = 'Close (Esc)';
	keyClose.setAttribute( 'aria-label', 'Close the keyframe options' );
	keyClose.style.cssText = 'width:20px;height:20px;padding:0;line-height:16px;border:none;border-radius:3px;background:transparent;color:inherit;font-size:15px;cursor:pointer;display:none;';
	keyClose.addEventListener( 'click', closeKeyPopover );
	keyHeader.appendChild( keyClose );

	const keyGrid = document.createElement( 'div' );
	keyGrid.style.cssText = 'display:grid;grid-template-columns:60px auto;gap:3px 6px;align-items:center;';
	keyPanel.appendChild( keyGrid );
	keyPanel.insertBefore( keyActions, keyGrid );

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
	tintAxes( kpX, kpY, kpZ );

	keyLabel( 'Rotation' );
	const krX = keyNum( '°' ), krY = keyNum( '°' ), krZ = keyNum( '°' );
	keyFieldRow( [ krX, krY, krZ ] );
	tintAxes( krX, krY, krZ );

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
	tintAxes( ksX, ksY, ksZ );

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

		if ( ! selectedEventId || selectedIds.size !== 1 || ! editor.timeline ) return null; // the options are for one key
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
	// ── Camera path tools (shown when a shot camera is selected; see CameraPath.js) ──
	const camRow = document.createElement( 'div' );
	camRow.style.cssText = 'display:none;flex-direction:column;gap:4px;padding:4px 0;border-bottom:1px solid #ccc;';
	keyPanel.insertBefore( camRow, keyGrid );

	const camButtons = document.createElement( 'div' );
	camButtons.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;';
	camRow.appendChild( camButtons );

	const smallButton = ( label, title, fn ) => {

		const b = new UIButton( label );
		b.dom.style.cssText = 'height:22px;padding:0 8px;border-radius:4px;font-size:11px;';
		b.dom.title = title;
		b.onClick( fn );
		camButtons.appendChild( b.dom );
		return b;

	};

	smallButton( '+ Key from view', 'Add a key at the playhead from the Edit Camera view: its position, where it is looking, and its field of view', addKeyFromView );
	const splineWrap = document.createElement( 'label' );
	splineWrap.style.cssText = 'display:flex;gap:4px;align-items:center;cursor:pointer;';
	splineWrap.title = 'Play this camera as one smooth path through its keys, instead of straight legs';
	const splineBox = document.createElement( 'input' );
	splineBox.type = 'checkbox';
	splineBox.addEventListener( 'change', function () { setSpline( splineBox.checked ); } );
	splineWrap.appendChild( splineBox );
	splineWrap.appendChild( document.createTextNode( 'Smooth path' ) );
	camButtons.appendChild( splineWrap );
	smallButton( 'Copy as command', 'Copy the shell command that rebuilds this camera move exactly (the same keys the viewport shows)', copyMoveCommand );
	const simplifyButton = smallButton( 'Simplify…', 'Replace a dense run of keys with a few that follow the same smooth path: pick a tolerance, see the result, then apply', toggleSimplifyPanel );
	const deleteKeyButton = smallButton( 'Delete key', 'Delete the key selected in the viewport (Delete key)', function () { if ( editor.cameraPath ) editor.cameraPath.deleteSelected(); } );

	const camInfo = document.createElement( 'div' );
	camInfo.style.cssText = 'color:#666;font-size:10px;';
	camRow.appendChild( camInfo );

	// Simplify: tolerance step + live "195 → 12 keys" preview (pure, nothing is changed until Apply)
	const simplifyPanel = document.createElement( 'div' );
	simplifyPanel.className = 'cam-simplify';
	simplifyPanel.style.cssText = 'display:none;flex-direction:column;gap:4px;padding:4px;border:1px solid #ccc;border-radius:4px;font-size:11px;';
	camRow.appendChild( simplifyPanel );

	const simplifyControls = document.createElement( 'div' );
	simplifyControls.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;';
	simplifyPanel.appendChild( simplifyControls );

	const tolSelect = document.createElement( 'select' );
	tolSelect.className = 'cam-simplify-tolerance';
	tolSelect.title = 'How far the simplified path may stray from the original keys';
	for ( const [ id, label ] of [ [ 'tight', 'Tight' ], [ 'normal', 'Normal' ], [ 'loose', 'Loose' ] ] ) {

		const p = camMove.SIMPLIFY_PRESETS[ id ];
		const o = document.createElement( 'option' );
		o.value = id;
		o.textContent = label;
		o.title = `${ p.tolerance } units, ${ p.rotation }° aim, ${ p.fov }° fov, up to ${ p.maxKeys } keys`;
		tolSelect.appendChild( o );

	}
	tolSelect.value = 'normal';
	tolSelect.addEventListener( 'change', updateSimplifyPreview );
	simplifyControls.appendChild( tolSelect );

	const beatsWrap = document.createElement( 'label' );
	beatsWrap.style.cssText = 'display:flex;gap:4px;align-items:center;cursor:pointer;';
	beatsWrap.title = 'Always keep the first and last key, the keys where the shot starts and ends in the Camera Sequence, and where the move eases in or out';
	const beatsBox = document.createElement( 'input' );
	beatsBox.type = 'checkbox';
	beatsBox.className = 'cam-simplify-beats';
	beatsBox.checked = true;
	beatsBox.addEventListener( 'change', updateSimplifyPreview );
	beatsWrap.appendChild( beatsBox );
	beatsWrap.appendChild( document.createTextNode( 'Keep beats' ) );
	simplifyControls.appendChild( beatsWrap );

	const simplifyPreviewText = document.createElement( 'span' );
	simplifyPreviewText.className = 'cam-simplify-preview';
	simplifyPreviewText.style.cssText = 'font-weight:600;';
	simplifyControls.appendChild( simplifyPreviewText );

	const simplifyActions = document.createElement( 'div' );
	simplifyActions.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;';
	simplifyPanel.appendChild( simplifyActions );

	const mkSimplifyButton = ( label, title, fn, cls ) => {

		const b = new UIButton( label );
		b.dom.style.cssText = 'height:22px;padding:0 8px;border-radius:4px;font-size:11px;';
		b.dom.title = title;
		b.dom.classList.add( cls );
		b.onClick( fn );
		simplifyActions.appendChild( b.dom );
		return b;

	};

	const applyButton = mkSimplifyButton( 'Apply', 'Replace this camera\'s keys with the simplified ones (one undo step)', simplifyCameraTrack, 'cam-simplify-apply' );
	const allButton = mkSimplifyButton( 'Simplify all cameras', 'Simplify every shot camera\'s move with these settings, in one undo step', simplifyAllShotCameras, 'cam-simplify-all' );
	const allPreviewText = document.createElement( 'span' );
	allPreviewText.className = 'cam-simplify-all-preview';
	allPreviewText.style.cssText = 'color:#666;';
	simplifyActions.appendChild( allPreviewText );

	function selectedShotCamera() {

		const o = editor.selected;
		if ( o && o.isCamera && o !== editor.camera ) return o;
		// a selected key on a camera's track belongs to that camera, even though the camera object is not selected
		const found = selectedAnimateEvent();
		return found ? cameraForTrack( found.track ) : null;

	}

	function cameraForTrack( track ) {

		return Object.values( editor.cameras || {} ).find( c => c !== editor.camera && cameraSelectors( c ).includes( track.target ) ) || null;

	}

	// Toolbar "Simplify": show the Simplify panel for the camera in play
	function openSimplify() {

		let cam = selectedShotCamera();
		if ( ! cam ) {

			const dense = simplifiableCameras( editor );
			if ( ! dense.length ) { camInfo.textContent = 'No camera has 4 or more keys to simplify.'; return; }
			cam = dense[ 0 ];
			editor.select( cam ); // shows the camera tools (inline above the code panel) for it

		}

		refreshKeyPanel();
		simplifyPanel.style.display = 'flex';
		updateSimplifyPreview();
		positionKeyPopover();
		simplifyPanel.scrollIntoView( { block: 'nearest' } );

	}

	function cameraTrackOf( camera ) {

		return findCameraTrack( editor.timeline, camera );

	}

	// Camera edits go through intelligence/cameraMove.js, the same operations the shell's
	// $S('#cam').keyAt() / moveKey() / ... call, so both land on one track and one undo stack.
	function addKeyFromView() {

		const object = selectedShotCamera();
		if ( ! object ) return;
		let spec;
		try { spec = specFromEditCamera( editor ); } catch ( e ) {

			camInfo.textContent = 'Switch the viewport to Edit Camera, orbit to frame the shot, then add the key.';
			return;

		}
		const time = Math.round( playhead * 1000 ) / 1000;
		editCameraTrack( editor, object, 'Add camera key from view', track => camMove.upsertKey( track, { ...spec, time } ) );
		sampleAt( playhead );

	}

	function setSpline( on ) {

		const object = selectedShotCamera();
		if ( ! object || ! cameraTrackOf( object ) ) return;
		editCameraTrack( editor, object, on ? 'Camera: smooth path' : 'Camera: straight legs', track => camMove.setSmooth( track, on ) );
		sampleAt( playhead );

	}

	function simplifyChoice() {

		return { preset: tolSelect.value, keepBeats: beatsBox.checked };

	}

	function toggleSimplifyPanel() {

		simplifyPanel.style.display = simplifyPanel.style.display === 'none' ? 'flex' : 'none';
		updateSimplifyPreview();

	}

	function updateSimplifyPreview() {

		if ( simplifyPanel.style.display === 'none' ) return;
		const object = selectedShotCamera();
		const t = object ? cameraTrackOf( object ) : null;
		const choice = simplifyChoice();
		if ( t ) {

			const r = camMove.previewSimplify( t, optionsFor( editor, object, choice ) );
			simplifyPreviewText.textContent = r.changed ? r.before + ' \u2192 ' + r.after + ' keys' + ( r.worst > 1 ? ' (key limit reached, looser than the tolerance)' : '' ) : r.before + ' keys (nothing to remove)';
			applyButton.dom.disabled = ! r.changed;

		} else {

			simplifyPreviewText.textContent = '';
			applyButton.dom.disabled = true;

		}
		const all = simplifyAllCameras( editor, choice, { dryRun: true } );
		allPreviewText.textContent = all.cameras ? all.cameras + ' camera' + ( all.cameras === 1 ? '' : 's' ) + ': ' + all.before + ' \u2192 ' + all.after + ' keys' : '';
		allButton.dom.disabled = ! all.changed;

	}

	function simplifyCameraTrack() {

		const object = selectedShotCamera();
		const t = cameraTrackOf( object );
		if ( ! t ) return;
		if ( cameraKeys( t.events ).length < 4 ) { camInfo.textContent = 'Already a handful of keys.'; return; }
		const opts = optionsFor( editor, object, simplifyChoice() );
		const r = editCameraTrack( editor, object, 'Simplify camera keys', track => camMove.simplifyTrack( track, opts ) );
		camInfo.textContent = 'Simplified ' + r.before + ' keys to ' + r.after + ' on a smooth path.';
		sampleAt( playhead );

	}

	function simplifyAllShotCameras() {

		const r = simplifyAllCameras( editor, simplifyChoice() );
		camInfo.textContent = r.cameras + ' camera' + ( r.cameras === 1 ? '' : 's' ) + ': ' + r.before + ' \u2192 ' + r.after + ' keys';
		sampleAt( playhead );

	}

	function copyMoveCommand() {

		const object = selectedShotCamera();
		const t = object ? cameraTrackOf( object ) : null;
		if ( ! t ) { camInfo.textContent = 'No keys to copy yet.'; return; }
		const text = camMove.toCommand( t, moveSelector( editor, object ) );
		const done = () => { camInfo.textContent = 'Copied the camera move as a shell command.'; };
		if ( navigator.clipboard && navigator.clipboard.writeText ) navigator.clipboard.writeText( text ).then( done, () => { camInfo.textContent = text; } );
		else camInfo.textContent = text;

	}

	function refreshCamRow() {

		const cam = selectedShotCamera();
		if ( ! cam ) { camRow.style.display = 'none'; return; }
		camRow.style.display = 'flex';
		const t = cameraTrackOf( cam );
		const n = t ? cameraKeys( t.events ).length : 0;
		splineBox.checked = !! ( t && t.spline );
		splineBox.disabled = ! t;
		const anySimplifiable = simplifiableCameras( editor ).length > 0;
		simplifyButton.dom.style.display = n >= 4 || anySimplifiable ? '' : 'none';
		if ( ! ( n >= 4 || anySimplifiable ) ) simplifyPanel.style.display = 'none';
		updateSimplifyPreview();
		deleteKeyButton.dom.style.display = ! selectedAnimateEvent() && editor.cameraPath && editor.cameraPath.selectedKeyId ? '' : 'none';
		camInfo.textContent = n ? n + ' key' + ( n === 1 ? '' : 's' ) + ( t.spline ? ', smooth path' : ', straight legs' ) + '. Click a handle in the Edit Camera view to move it.' : 'No keys yet: orbit the Edit Camera to frame the shot, set the playhead, and press + Key from view.';

	}

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

		// With a key selected the new key goes on that key's track (a copy of its pose at the playhead);
		// otherwise it goes on the selected object's track, from the staged pose fields.
		const found = selectedAnimateEvent();
		const object = editor.selected;
		if ( ! found && ( ! object || object === editor.scene ) ) {

			keyTitle.textContent = 'Select an object first';
			return;

		}

		const target = found ? found.track.target : bestSelectorFor( object );
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
		const id = 'key_' + Date.now().toString( 36 ) + Math.random().toString( 36 ).slice( 2, 6 );
		if ( found ) setSelection( [ id ], true ); // the popover follows to the new key
		commitMutation( m => m.addEvent( target, { id, at, op: 'animate', args: { props, easing: 'linear', duration: dur }, dur } ), 'Add key' );
		sampleAt( playhead );

	}

	// ── Key popover: placement ────────────────────────────────────────────────
	function themeColors() {

		// the popover is outside the sidebar: take the sidebar's own background and text color
		let el = container.dom, bg = '';
		while ( el ) {

			const c = getComputedStyle( el ).backgroundColor;
			if ( c && c !== 'transparent' && ! /rgba\(.*,\s*0\)$/.test( c ) ) { bg = c; break; }
			el = el.parentElement;

		}
		return { bg: bg || '#fff', color: getComputedStyle( container.dom ).color || '#222' };

	}

	function keyBlockEl() {

		return selectedEventId ? blockEls.get( selectedEventId ) || null : null;

	}

	// The popover never sits over the animation editor (timeline, code panel): it floats beside the whole
	// tab, in the viewport next to the sidebar, level with the selected block. When the window leaves no
	// room on either side (a narrow window, the sidebar docked at the bottom) the options stay inline.
	function floatSide() {

		if ( container.dom.offsetParent === null ) return null;
		const rc = container.dom.getBoundingClientRect(), need = KEY_POP_W + KEY_POP_GAP + 8;
		if ( rc.left >= need ) return 'left';
		if ( window.innerWidth - rc.right >= need ) return 'right';
		return null;

	}

	function positionKeyPopover() {

		if ( ! keyPopoverOn ) return;
		const block = keyBlockEl();
		const vis = rows.getBoundingClientRect();
		const r = block ? block.getBoundingClientRect() : null;
		const side = floatSide();
		// hidden with its tab, or while the key's block is scrolled out of the track list
		if ( ! side || ! r || r.bottom < vis.top || r.top > vis.bottom ) {

			keyPop.style.visibility = 'hidden';
			return;

		}

		keyPop.style.display = 'block';
		keyPop.style.visibility = 'visible';
		const rc = container.dom.getBoundingClientRect(), pw = keyPop.offsetWidth, ph = keyPop.offsetHeight, m = 8;
		const cy = Math.min( Math.max( r.top + r.height / 2, vis.top ), vis.bottom ); // level with the block, kept inside the track list
		const left = side === 'left' ? rc.left - KEY_POP_GAP - pw : rc.right + KEY_POP_GAP;
		const top = Math.min( Math.max( m, cy - 28 ), Math.max( m, window.innerHeight - ph - m ) ); // fully inside the window
		keyPop.style.left = Math.round( left ) + 'px';
		keyPop.style.top = Math.round( top ) + 'px';

		const colors = themeColors();
		keyPop.style.background = colors.bg;
		keyPop.style.color = colors.color;
		keyArrow.style.background = colors.bg;
		keyArrow.style.border = '1px solid #888';
		keyArrow.style.top = Math.round( Math.min( Math.max( 12, cy - top - 5 ), ph - 22 ) ) + 'px'; // points at the block's row
		keyArrow.style.bottom = '';
		if ( side === 'left' ) { keyArrow.style.right = '-6px'; keyArrow.style.left = ''; keyArrow.style.borderLeftColor = keyArrow.style.borderBottomColor = 'transparent'; }
		else { keyArrow.style.left = '-6px'; keyArrow.style.right = ''; keyArrow.style.borderRightColor = keyArrow.style.borderTopColor = 'transparent'; }

	}

	function setKeyPopover( on ) {

		if ( on === keyPopoverOn ) { if ( on ) positionKeyPopover(); return; }
		keyPopoverOn = on;
		keyClose.style.display = on ? '' : 'none';
		if ( on ) {

			keyPanel.style.cssText = KEY_POPOVER_CSS;
			keyPop.appendChild( keyPanel );
			keyPop.style.display = 'block';
			positionKeyPopover();

		} else {

			keyPop.style.display = 'none';
			keyPanel.style.cssText = KEY_INLINE_CSS;
			container.dom.insertBefore( keyPanel, splitter );

		}

	}

	// With a key selected the add / delete buttons sit in a row under the title; otherwise the add button is in the header
	function layoutKeyButtons( keySelected ) {

		if ( keySelected ) {

			keyActions.appendChild( keyButton.dom ); // Delete key, then + Key @ playhead to its right
			keyActions.style.display = 'flex';

		} else {

			keyActions.style.display = 'none';
			keyHeader.insertBefore( keyButton.dom, keyCodeLink );

		}

	}

	function closeKeyPopover() {

		setSelection( [] );

	}

	function refreshKeyPanel() {

		const found = selectedAnimateEvent();
		const object = editor.selected;

		if ( found ) {

			setKeyPopover( floatSide() !== null ); // beside the tab when there is room, inline otherwise
			layoutKeyButtons( true );
			keyPanel.style.display = 'flex';
			keyButton.dom.style.display = '';
			keyTitle.textContent = `Key @ ${ found.event.at.toFixed( 2 ) }s \u00b7 ${ found.track.target }`;
			updateLookAtOptions( null );
			fillFieldsFromProps( found.event.args && found.event.args.props );

		} else {

			setKeyPopover( false );
			layoutKeyButtons( false );

			if ( object && object !== editor.scene ) {

				keyPanel.style.display = 'flex';
				keyButton.dom.style.display = '';
				keyTitle.textContent = `Keyframe: ${ object.name || object.type }`;
				updateLookAtOptions( object );
				fillFieldsFromObject( object );

			} else {

				keyPanel.style.display = 'none';

			}

		}

		refreshCamRow(); // after the popover state is known: it owns the Delete key button while a key is selected
		const line = selectedEventId ? eventLines.get( selectedEventId ) : null;
		keyCodeLink.style.display = found && line ? '' : 'none';
		keyCodeLink.textContent = line ? 'line ' + line : '';
		revealKeyInCode( false );
		positionKeyPopover(); // the title and the fields above may have changed its height
		updateAddKeyState();

	}

	// ── Time <-> pixel mapping ────────────────────────────────────────────────
	// Total scrub/view range: the authored (sugar-script) timeline AND any
	// imported clips (e.g. a glTF/GLB's baked animation) ride the SAME clock,
	// so the longer of the two decides how far the ruler/playhead range reaches.
	function totalDuration() {

		const authored = editor.timeline ? editor.timeline.duration : 0;
		return Math.max( authored, ...getImportedClips( editor ).map( c => c.duration || 0 ), 0 );

	}

	function viewDuration() {

		return Math.max( MIN_VIEW, totalDuration() );

	}

	function viewSpan() {

		return zoomSpan === null ? viewDuration() : Math.min( zoomSpan, viewDuration() );

	}

	function laneWidth() {

		return Math.max( 1, area.clientWidth - LABEL_W );

	}

	function timeToPx( t ) {

		return ( ( t - viewStart ) / viewSpan() ) * laneWidth();

	}

	function pxToTime( px ) {

		return Math.max( 0, viewStart + ( px / laneWidth() ) * viewSpan() );

	}

	// ── Zoom / pan ────────────────────────────────────────────────────────────
	// zoomSpan === null shows the whole timeline (viewStart 0); otherwise the lane shows [viewStart, viewStart + zoomSpan].
	// Every mapping above and the drag handlers go through viewStart / viewSpan(), so nothing else knows about zoom.
	function currentView() {

		return { start: viewStart, span: viewSpan() };

	}

	function updateZoomReadout() {

		const z = zoomSpan === null ? 1 : viewDuration() / zoomSpan;
		zoomReadout.textContent = z.toFixed( z < 10 ? 1 : 0 ).replace( /\.0$/, '' ) + '\u00d7';

	}

	function setView( v ) {

		const total = viewDuration();
		const c = view.clampView( v.start, v.span, total );
		const fit = c.span >= total - 1e-9;
		zoomSpan = fit ? null : c.span;
		viewStart = fit ? 0 : c.start;
		updateZoomReadout();
		render();
		updatePlayheadUI();

	}

	// `anchorPx`: where across the lane the zoom is centred (null: the playhead when it is on screen, else the middle)
	function zoomAt( factor, anchorPx ) {

		const lw = laneWidth();
		let px = anchorPx;
		if ( px === null ) {

			const p = timeToPx( playhead );
			px = p >= 0 && p <= lw ? p : lw / 2;

		}
		setView( view.zoomView( currentView(), viewDuration(), factor, px / lw ) );

	}

	function fitView() {

		setView( { start: 0, span: viewDuration() } );

	}

	function panBy( dPx ) {

		if ( zoomSpan === null ) return;
		setView( view.panView( currentView(), viewDuration(), ( dPx / laneWidth() ) * viewSpan() ) );

	}

	// bring an event's block into view (only when zoomed: a fitted lane shows everything)
	function panToEvent( id ) {

		const found = editor.timeline ? editor.timeline.findEvent( id ) : null;
		if ( ! found || zoomSpan === null ) return;
		const { at, dur } = found.event;
		if ( at >= viewStart && at + dur <= viewStart + zoomSpan ) return;
		setView( view.clampView( at + dur / 2 - zoomSpan / 2, zoomSpan, viewDuration() ) );
		renderNow();

	}

	// ── Snap grid ─────────────────────────────────────────────────────────────
	function applySnapUI() {

		snapButton.classList.toggle( 'on', gridSnap );
		snapButton.setAttribute( 'aria-pressed', String( gridSnap ) );
		const title = gridSnap ? 'Snap to the grid is on: drags land on the ruler\'s ticks (the playhead and other blocks\' edges still win; hold Alt to move freely). Click to turn off' : 'Snap to the grid: make drags land on the ruler\'s ticks (shows a faint grid)';
		snapButton.title = title;
		snapButton.setAttribute( 'aria-label', 'Snap drags to the grid' );
		updateGrid();

	}

	function updateGrid() {

		const lw = laneWidth();
		const g = gridSnap ? ui.gridBackground( currentView(), ui.gridUnit( viewSpan(), lw ), lw ) : null;
		gridEl.style.display = g ? 'block' : 'none';
		if ( ! g ) return;
		gridEl.style.backgroundSize = g.size + 'px 100%';
		gridEl.style.backgroundPosition = g.offset + 'px 0';

	}

	applySnapUI();

	// ── Mini-map: the whole timeline above the ruler while zoomed ─────────────
	// Event density behind a window that is the view; drag the window (or click the bar) to pan, arrow keys nudge it.
	function positionMiniWindow() {

		const w = miniBar.clientWidth, total = viewDuration();
		const win = ui.miniMapWindow( currentView(), total, w );
		miniWindow.style.left = win.left + 'px';
		miniWindow.style.width = win.width + 'px';
		miniHead.style.left = Math.min( w, ( playhead / total ) * w ) + 'px';
		miniBar.setAttribute( 'aria-valuemin', '0' );
		miniBar.setAttribute( 'aria-valuemax', String( Math.round( total ) ) );
		miniBar.setAttribute( 'aria-valuenow', String( Math.round( viewStart ) ) );

	}

	function updateMiniMap( model ) {

		miniMap.style.display = zoomSpan === null ? 'none' : 'flex'; // hidden while fitted
		if ( zoomSpan === null ) return;
		const w = miniBar.clientWidth, total = viewDuration();
		const bins = Math.max( 16, Math.min( 160, Math.floor( w / 3 ) ) );
		const blocks = [];
		for ( const t of model.tracks ) for ( const e of t.events ) blocks.push( e );
		for ( const c of getImportedClips( editor ) ) blocks.push( { at: 0, dur: c.duration || 0 } );
		const counts = ui.densityBins( blocks, total, bins );
		const peak = Math.max( 1, ...counts );
		const frag = document.createDocumentFragment();
		for ( const n of counts ) {

			const bin = document.createElement( 'i' );
			bin.style.height = n ? Math.max( 18, ( n / peak ) * 100 ) + '%' : '0';
			frag.appendChild( bin );

		}
		miniBins.replaceChildren( frag );
		positionMiniWindow();

	}

	miniBar.addEventListener( 'pointerdown', function ( e ) {

		if ( e.button !== 0 || zoomSpan === null ) return;
		e.preventDefault();
		const rect = miniBar.getBoundingClientRect(), total = viewDuration();
		const win = ui.miniMapWindow( currentView(), total, rect.width );
		const x = e.clientX - rect.left;
		let grab = win.width / 2; // where in the window the pointer holds it
		if ( x >= win.left && x <= win.left + win.width ) grab = x - win.left;
		else setView( ui.miniMapCenterView( currentView(), total, rect.width, x ) );
		positionMiniWindow();
		miniBar.setPointerCapture( e.pointerId );
		miniWindow.classList.add( 'dragging' );

		function move( ev ) {

			setView( ui.miniMapDragView( currentView(), total, rect.width, ev.clientX - rect.left - grab ) );
			positionMiniWindow();

		}
		function up() {

			miniWindow.classList.remove( 'dragging' );
			miniBar.removeEventListener( 'pointermove', move );
			miniBar.removeEventListener( 'pointerup', up );
			miniBar.removeEventListener( 'pointercancel', up );

		}
		miniBar.addEventListener( 'pointermove', move );
		miniBar.addEventListener( 'pointerup', up );
		miniBar.addEventListener( 'pointercancel', up );

	} );

	miniBar.addEventListener( 'keydown', function ( e ) {

		if ( zoomSpan === null || ( e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' ) ) return;
		e.preventDefault();
		setView( view.panView( currentView(), viewDuration(), ( e.key === 'ArrowLeft' ? - 0.1 : 0.1 ) * viewSpan() ) );

	} );

	// ── Previous / next key ───────────────────────────────────────────────────
	// The playhead jumps to the nearest block edge on the selected key's track (or the track of the selected object),
	// on every track when none is selected. `[` and `]` do the same while the tab is showing and nothing is being typed in.
	function keyNavTracks() {

		const model = editor.timeline;
		if ( ! model ) return [];
		const picked = new Set();
		for ( const id of selectedIds ) { const f = model.findEvent( id ); if ( f ) picked.add( f.track ); }
		const object = editor.selected;
		if ( picked.size === 0 && object && object !== editor.scene ) {

			const t = model.tracks.find( t => t.target === bestSelectorFor( object ) ) || findCameraTrack( model, object );
			if ( t ) picked.add( t );

		}
		return picked.size ? [ ...picked ] : model.tracks;

	}

	function stepKey( dir ) {

		const times = ui.keyTimes( keyNavTracks() );
		const t = dir < 0 ? ui.prevKeyTime( times, playhead ) : ui.nextKeyTime( times, playhead );
		if ( t === null ) return false;
		gotoTime( t );
		if ( zoomSpan !== null && ( t < viewStart || t > viewStart + zoomSpan ) ) setView( view.clampView( t - zoomSpan / 2, zoomSpan, viewDuration() ) );
		return true;

	}

	document.addEventListener( 'keydown', function ( e ) {

		if ( ( e.key !== '[' && e.key !== ']' ) || e.ctrlKey || e.metaKey || e.altKey ) return;
		if ( container.dom.offsetParent === null ) return; // tab not visible
		const t = e.target;
		if ( t && ( t.isContentEditable || ( t.closest && t.closest( '.monaco-editor' ) ) || /^(TEXTAREA|SELECT)$/.test( t.tagName ) || ( t.tagName === 'INPUT' && ! /^(checkbox|radio|button|range)$/.test( t.type ) ) ) ) return;
		e.preventDefault();
		stepKey( e.key === '[' ? - 1 : 1 );

	} );

	// ── Track kinds ───────────────────────────────────────────────────────────
	// What a track's selector resolves to decides its colour and icon (camera / character / prop / light / group / other).
	// The lookup is cached per selector and dropped whenever the scene graph changes.
	const kindCache = new Map();
	signals.sceneGraphChanged.add( () => kindCache.clear() );

	function objectKindOf( target ) {

		if ( ! kindCache.has( target ) ) {

			let nodes = [];
			try { nodes = nodesForTarget( editor, target ); } catch ( e ) { nodes = []; }
			kindCache.set( target, nodes.length ? ui.classifyObject( nodes[ 0 ] ) : null );

		}
		return kindCache.get( target );

	}

	function trackKind( track ) {

		return ui.classifyTrack( track, null, objectKindOf( track.target ) );

	}

	// a camera track's shot starts: from the Render tab's Camera Sequence, else its first key
	function shotMarkersFor( track ) {

		const ud = editor.scene.userData;
		const shots = ud && Array.isArray( ud.renderShots ) ? ud.renderShots : [];
		let first = null;
		for ( const e of track.events ) if ( first === null || e.at < first ) first = e.at;
		return ui.shotMarkers( shots, s => {

			const camera = editor.cameras && editor.cameras[ s.camera ];
			return !! camera && findCameraTrack( editor.timeline, camera ) === track;

		}, first );

	}

	// ── Selection ─────────────────────────────────────────────────────────────
	const blockEls = new Map(); // event id -> its block in the track list (only blocks inside the view exist)

	// `quiet`: skip refreshing the key options (the caller is about to change the timeline, which does)
	function setSelection( ids, quiet ) {

		const next = [ ...new Set( ids ) ];
		const prev = [ ...selectedIds ];
		if ( next.length === prev.length && next.every( ( id, i ) => id === prev[ i ] ) ) return;

		selectedIds = new Set( next );
		selectedEventId = next.length ? next[ 0 ] : null;
		for ( const id of [ ...prev, ...next ] ) {

			const el = blockEls.get( id );
			if ( el ) el.classList.toggle( 'selected', selectedIds.has( id ) );

		}
		deleteButton.dom.disabled = next.length === 0;
		if ( ! quiet ) refreshKeyPanel();

	}

	// ── Rendering ─────────────────────────────────────────────────────────────
	// render() / renderCode() only mark the panel dirty: any number of changes in one frame cost ONE rebuild.
	// Moving the playhead, selecting or snapping never rebuild (they restyle what is there).
	let framePending = false, rowsDirty = false, codeDirty = false;

	function queueFrame() {

		if ( framePending ) return;
		framePending = true;
		requestAnimationFrame( flushFrame );

	}

	function flushFrame() {

		framePending = false;
		if ( codeDirty ) { codeDirty = false; refreshCode(); } // first: the key options read the line map it rebuilds
		if ( rowsDirty ) { rowsDirty = false; rebuild(); positionKeyPopover(); } // the layout may have moved the block the key popover points at

	}

	function render() {

		rowsDirty = true;
		queueFrame();

	}

	function renderCode() {

		codeDirty = true;
		queueFrame();

	}

	function renderNow() {

		if ( rowsDirty ) { rowsDirty = false; rebuild(); }

	}

	function rebuild() {

		const model = editor.timeline || new TimelineModel();
		refreshMotionBar();

		const total = viewDuration();
		if ( zoomSpan !== null ) {

			const c = view.clampView( viewStart, zoomSpan, total );
			viewStart = c.start;
			zoomSpan = c.span >= total - 1e-9 ? null : c.span;
			if ( zoomSpan === null ) viewStart = 0;

		}
		updateZoomReadout();
		hideTip(); // the blocks it described are about to be replaced
		updateGrid();
		updateMiniMap( model );

		const m = { start: viewStart, span: viewSpan(), lw: laneWidth() };

		// a change (undo, a code edit, a delete) can drop events that were selected
		const hadSelection = selectedIds.size > 0;
		if ( hadSelection ) setSelection( [ ...selectedIds ].filter( id => model.findEvent( id ) ), true );

		// Ruler: labelled ticks at least ~64 px apart, minor ticks between them, only inside the view.
		const rulerFrag = document.createDocumentFragment();
		for ( const { t, major } of view.rulerTicks( m.start, m.span, m.lw ).ticks ) {

			const tick = document.createElement( 'div' );
			tick.style.cssText = `position:absolute;left:${ ( ( t - m.start ) / m.span ) * m.lw }px;top:${ major ? 0 : 12 }px;bottom:0;border-left:1px solid ${ major ? '#bbb' : '#e2e2e2' };font-size:9px;color:#999;padding-left:2px;white-space:nowrap;`;
			if ( major ) tick.textContent = formatClockMs( t );
			rulerFrag.appendChild( tick );

		}
		ruler.replaceChildren( rulerFrag );

		blockEls.clear();
		const imported = getImportedClips( editor );

		if ( model.isEmpty() && imported.length === 0 ) {

			rows.replaceChildren( emptyHint );
			updatePlayheadUI();
			if ( hadSelection ) refreshKeyPanel();
			return;

		}

		const rowsFrag = document.createDocumentFragment();
		for ( const clip of imported ) rowsFrag.appendChild( importedClipRow( clip, m ) );
		for ( const track of model.tracks ) rowsFrag.appendChild( trackRow( track, m ) );
		rows.replaceChildren( rowsFrag );

		updatePlayheadUI();
		if ( hadSelection ) refreshKeyPanel(); // with no key selected the panel shows the object's pose, which a rebuild does not change

	}

	// A read-only row for an imported clip (e.g. glTF/GLB baked animation) — it
	// isn't TimelineModel-backed (arbitrary per-frame keyframe data isn't
	// expressible as `.animate()` sugar), so unlike trackRow() it has no drag/
	// resize handlers, just a single block spanning the clip's own duration.
	function importedClipRow( clip, m ) {

		const row = document.createElement( 'div' );
		row.style.cssText = 'display:flex;align-items:center;height:26px;border-bottom:1px solid #eee;';

		const clipTitle = `Imported animation clip (baked tracks are read-only) — ${ clip.tracks.length } track${ clip.tracks.length === 1 ? '' : 's' }, ${ clip.duration.toFixed( 2 ) }s`;
		const label = rowLabel( clip.name || 'Imported clip', clipTitle, 'Delete this imported clip', function () {

			if ( ! confirm( `Delete the imported clip "${ clip.name || 'clip' }" and its ${ clip.tracks.length } baked track(s)? (Undo restores it.)` ) ) return;
			deleteImportedClip( clip );

		}, 'clip' );
		row.appendChild( label );

		const lane = document.createElement( 'div' );
		lane.style.cssText = 'flex:1;height:100%;position:relative;background:rgba(0,0,0,0.02);overflow:hidden;';
		row.appendChild( lane );

		const block = document.createElement( 'div' );
		block.style.cssText = `position:absolute;left:${ ( ( 0 - m.start ) / m.span ) * m.lw }px;width:${ Math.max( 6, ( clip.duration / m.span ) * m.lw ) }px;top:4px;bottom:4px;` +
			'background:#9c27b0;border-radius:3px;opacity:0.7;font-size:9px;color:#fff;overflow:hidden;white-space:nowrap;padding:2px 4px;box-sizing:border-box;cursor:default;';
		block.textContent = 'imported: ' + ( clip.name || 'clip' );
		block.title = clipTitle;
		lane.appendChild( block );

		return row;

	}

	// Row label with the track kind's icon, the track name and a delete (×) button on the right.
	function rowLabel( text, title, deleteTitle, onDelete, kind ) {

		const label = document.createElement( 'div' );
		label.style.cssText = `width:${ LABEL_W }px;flex-shrink:0;box-sizing:border-box;padding:0 4px 0 6px;font-size:10px;color:#555;display:flex;align-items:center;gap:4px;`;
		label.title = title;

		if ( kind ) {

			const icon = document.createElement( 'span' );
			icon.className = 'timeline-track-icon k-' + kind;
			icon.innerHTML = ui.KIND_ICONS[ kind ] || '';
			label.appendChild( icon );

		}

		const name = document.createElement( 'span' );
		name.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
		name.textContent = text;
		label.appendChild( name );

		const del = document.createElement( 'button' );
		del.textContent = '\u00d7';
		del.title = deleteTitle;
		del.style.cssText = 'flex-shrink:0;width:16px;height:16px;padding:0;line-height:14px;border:none;border-radius:3px;background:transparent;color:#999;font-size:13px;cursor:pointer;';
		del.addEventListener( 'mouseenter', () => { del.style.background = '#e53935'; del.style.color = '#fff'; } );
		del.addEventListener( 'mouseleave', () => { del.style.background = 'transparent'; del.style.color = '#999'; } );
		del.addEventListener( 'mousedown', e => e.stopPropagation() ); // don't start a scrub
		del.addEventListener( 'click', function ( e ) { e.stopPropagation(); onDelete(); } );
		label.appendChild( del );

		return label;

	}

	// Remove an imported clip from the scene (undoable). Any directives that
	// reference it stay, and the script panel flags them as pointing at a missing clip.
	function deleteImportedClip( clip ) {

		editor.mixer.uncacheClip( clip );
		editor.execute( new SetValueCommand( editor, editor.scene, 'animations', ( editor.scene.animations || [] ).filter( c => c !== clip ) ) );
		signals.animationsChanged.dispatch();

	}

	function deleteTrack( track ) {

		const target = track.target;
		setSelection( [], true );
		commitMutation( m => {

			// a performer's track can't be deleted alone from a registered group — the whole group goes
			for ( const g of m.groups.filter( g => g.targets.includes( target ) ) ) m.removeGroup( g.id );
			m.tracks = m.tracks.filter( t => t.target !== target );
			m.recomputeDuration();

		}, `Delete track ${ target }` );

	}

	function trackRow( track, m ) {

		const kind = trackKind( track );
		const row = document.createElement( 'div' );
		row.style.cssText = 'display:flex;align-items:center;height:26px;border-bottom:1px solid #eee;';
		row.setAttribute( 'data-kind', kind );

		const label = rowLabel( track.target, track.target, 'Delete this track and all its events', () => deleteTrack( track ), kind );
		row.appendChild( label );

		const lane = document.createElement( 'div' );
		lane.style.cssText = 'flex:1;height:100%;position:relative;background:rgba(0,0,0,0.02);overflow:hidden;';
		row.appendChild( lane );

		// only the blocks inside the view (plus a block's width of margin) are built
		const pad = ( MIN_BLOCK_PX / m.lw ) * m.span;
		const frag = document.createDocumentFragment();
		for ( const ev of track.events ) if ( view.inView( ev.at, ev.dur, m.start, m.span, pad ) ) frag.appendChild( eventBlock( ev, m, kind ) );
		lane.appendChild( frag );

		if ( kind === 'camera' ) {

			for ( const s of shotMarkersFor( track ) ) {

				if ( s.t < m.start - 1e-9 || s.t > m.start + m.span ) continue;
				const tick = document.createElement( 'div' );
				tick.className = 'timeline-shot';
				tick.style.left = ( ( ( s.t - m.start ) / m.span ) * m.lw ) + 'px';
				const name = document.createElement( 'span' );
				name.className = 'timeline-shot-label';
				name.textContent = s.label;
				tick.appendChild( name );
				lane.appendChild( tick );

			}

		}

		return row;

	}

	// Blocks carry no listeners and no native title: the track list handles hover (the shared card) and clicks for all
	// of them (see "Block interaction"), which keeps a 1000-block rebuild cheap.
	function eventBlock( ev, m, kind ) {

		const block = document.createElement( 'div' );
		block.className = 'timeline-block k-' + kind;
		block.setAttribute( 'data-event-id', ev.id ); // the key popover anchors to this block
		blockEls.set( ev.id, block );

		const natural = ( ev.dur / m.span ) * m.lw;
		const width = Math.max( MIN_BLOCK_PX, natural ); // never too thin to hit
		block.style.cssText = `left:${ ( ( ev.at - m.start ) / m.span ) * m.lw }px;width:${ width }px;`;

		// A member of a registered performance group: the block is the group's CUT (its length is the
		// edit list's, it moves with the whole group, and each span boundary is drawn as a tick).
		const group = ev.args && ev.args.group && editor.timeline ? editor.timeline.group( ev.args.group ) : null;
		if ( group ) block.classList.add( 'group' );
		else if ( ev.op === FT.FACE_OP ) block.classList.add( 'face' );
		else if ( ev.op === FT.GAZE_OP ) block.classList.add( 'gaze' );
		if ( selectedIds.has( ev.id ) ) block.classList.add( 'selected' );

		if ( width >= 24 ) block.textContent = blockLabel( ev, group ); // a thinner block has no room for the name: the tooltip has it

		if ( group && group.edl ) {

			for ( const r of edlTable( group.edl ).slice( 1 ) ) {

				const tick = document.createElement( 'div' );
				tick.style.cssText = `position:absolute;left:${ ( r.outStart / m.span ) * m.lw }px;top:0;bottom:0;width:1px;background:rgba(255,255,255,0.8);pointer-events:none;`;
				block.appendChild( tick );

			}

		}

		if ( ! group && natural >= MIN_RESIZE_PX ) block.setAttribute( 'data-resizable', '1' ); // a thinner block selects on click: zoom in to resize it

		return block;

	}

	function blockLabel( ev, group ) {

		if ( group ) {

			const spans = group.edl ? group.edl.spans.length : 0;
			return `${ group.broken ? '\u26A0 ' : '\u2702 ' }${ group.id }${ spans ? ` · ${ spans } span${ spans === 1 ? '' : 's' }` : ' · uncut' }`;

		}

		if ( ev.op === FT.FACE_OP || ev.op === FT.GAZE_OP ) {

			const face = ev.op === FT.FACE_OP;
			const shapes = Object.keys( ev.args.shapes || {} );
			const what = face ? shapes.slice( 0, 2 ).join( ', ' ) + ( shapes.length > 2 ? '…' : '' ) : ( Array.isArray( ev.args.target ) ? 'point' : ev.args.target );
			return `${ face ? 'face' : 'gaze' } · ${ what }`;

		}

		return ev.op;

	}

	// ── Block interaction (one set of listeners on the track list) ────────────
	// Click selects; shift-click extends the selection along the track, ctrl / cmd-click toggles one block.
	// Dragging a block retimes it (and every other selected block by the same amount); dragging the grip on a
	// wide block's right edge resizes it. Both snap to the playhead and to other events' edges unless Alt is held.
	const round3 = v => Math.round( v * 1000 ) / 1000;

	function blockAt( target ) {

		const block = target && target.closest ? target.closest( '.timeline-block' ) : null;
		return block && rows.contains( block ) ? block : null;

	}

	function onGrip( block, clientX ) {

		return !! block.dataset.resizable && clientX >= block.getBoundingClientRect().right - HANDLE_PX;

	}

	// The hover card: ONE element for every block (no per-block listeners, no native title), filled from the model when
	// the pointer moves onto a different block and kept fully inside the window.
	const tip = document.createElement( 'div' );
	tip.className = 'timeline-tip';
	tip.setAttribute( 'role', 'tooltip' );
	document.body.appendChild( tip );
	let tipBlock = null;

	function hideTip() {

		tipBlock = null;
		tip.style.display = 'none';

	}

	function fillTip( block ) {

		const found = editor.timeline ? editor.timeline.findEvent( block.getAttribute( 'data-event-id' ) ) : null;
		if ( ! found ) return false;
		const group = found.event.args && found.event.args.group && editor.timeline.group( found.event.args.group );
		const card = ui.tooltipModel( found.event, { group, target: found.track.target } );
		const head = document.createElement( 'b' );
		head.textContent = card.title;
		const range = document.createElement( 'div' );
		range.className = 'range';
		range.textContent = card.range;
		tip.replaceChildren( head, range, ...card.lines.map( text => {

			const line = document.createElement( 'div' );
			line.className = 'line';
			line.textContent = text;
			return line;

		} ) );
		return true;

	}

	function showTip( block, x, y ) {

		if ( block !== tipBlock ) {

			if ( ! fillTip( block ) ) { hideTip(); return; }
			tipBlock = block;

		}
		tip.style.display = 'block';
		const at = ui.placeTip( { x, y }, { w: tip.offsetWidth, h: tip.offsetHeight }, { w: window.innerWidth, h: window.innerHeight } );
		tip.style.left = at.left + 'px';
		tip.style.top = at.top + 'px';

	}

	rows.addEventListener( 'mousemove', function ( e ) {

		if ( e.buttons ) { hideTip(); return; }
		const block = blockAt( e.target );
		if ( ! block ) { hideTip(); return; }
		block.style.cursor = onGrip( block, e.clientX ) ? 'ew-resize' : 'grab';
		showTip( block, e.clientX, e.clientY );

	} );

	rows.addEventListener( 'mouseleave', hideTip );
	rows.addEventListener( 'scroll', hideTip );
	rows.addEventListener( 'wheel', hideTip, { passive: true } );

	rows.addEventListener( 'mousedown', function ( e ) {

		if ( e.button !== 0 ) return;
		const block = blockAt( e.target );

		if ( block ) {

			e.stopPropagation();
			e.preventDefault();
			blockMouseDown( e, block );
			return;

		}

		// Only scrub when clicking empty lane space (not an event block).
		if ( e.target === rows || e.target.style.background === 'rgba(0, 0, 0, 0.02)' ) { scrubbing = true; scrubFrom( e.clientX ); }

	} );

	function blockMouseDown( e, block ) {

		const id = block.getAttribute( 'data-event-id' );
		const found = editor.timeline ? editor.timeline.findEvent( id ) : null;
		if ( ! found ) return;

		if ( e.shiftKey && selectedEventId && found.track.events.some( x => x.id === selectedEventId ) ) {

			const ordered = editor.timeline.sortedEvents( found.track ).map( x => x.id );
			setSelection( [ ...selectedIds, ...view.rangeIds( ordered, selectedEventId, id ) ] );
			return;

		}

		if ( e.shiftKey || e.ctrlKey || e.metaKey ) {

			setSelection( view.toggleId( [ ...selectedIds ], id ) );
			return;

		}

		const wasSelected = selectedIds.has( id ) && selectedIds.size > 1;
		if ( ! wasSelected ) setSelection( [ id ] ); // dragging a block that is part of a selection keeps the selection

		if ( onGrip( block, e.clientX ) ) startResize( e, found.event );
		else startRetime( e, found.event, wasSelected );

	}

	function snapTargets( skip ) {

		const times = [ playhead ];
		if ( editor.timeline ) for ( const t of editor.timeline.tracks ) for ( const x of t.events ) if ( ! skip.has( x.id ) ) times.push( x.at, x.at + x.dur );
		return view.makeSnapper( times );

	}

	function showSnapGuide( t ) {

		snapGuide.style.display = t === null ? 'none' : 'block';
		if ( t !== null ) snapGuide.style.left = ( LABEL_W + timeToPx( t ) ) + 'px';

	}

	function startRetime( e, ev, collapseOnClick ) {

		const lw = laneWidth(), span = viewSpan();
		const moving = [ ...selectedIds ].map( id => editor.timeline.findEvent( id ) ).filter( Boolean ).map( f => ( { id: f.event.id, at: f.event.at } ) );
		const snapper = snapTargets( selectedIds );
		const maxDist = ( SNAP_PX / lw ) * span;
		const gridStep = ui.gridUnit( span, lw );
		const minAt = Math.min( ...moving.map( x => x.at ) );
		const startX = e.clientX;
		let moved = false, dt = 0;

		function onMove( me ) {

			if ( Math.abs( me.clientX - startX ) > 2 ) moved = true;
			if ( ! moved ) return;
			dt = Math.max( ( ( me.clientX - startX ) / lw ) * span, - minAt );
			let guide = null;
			if ( ! me.altKey ) {

				const s = view.snapMove( snapper, ev.at + dt, ev.dur, maxDist );
				if ( s.guide !== null ) { dt = Math.max( s.start - ev.at, - minAt ); guide = s.guide; }
				else if ( gridSnap ) dt = Math.max( ui.snapMoveToGrid( ev.at + dt, ev.dur, gridStep ) - ev.at, - minAt ); // no edge close: onto the grid

			}
			for ( const x of moving ) {

				const el = blockEls.get( x.id );
				if ( el ) el.style.left = ( ( ( x.at + dt - viewStart ) / span ) * lw ) + 'px';

			}
			showSnapGuide( guide );

		}

		function onUp() {

			document.removeEventListener( 'mousemove', onMove );
			document.removeEventListener( 'mouseup', onUp );
			showSnapGuide( null );
			if ( moved ) commitMutation( m => { for ( const x of moving ) m.moveEvent( x.id, round3( x.at + dt ) ); }, moving.length > 1 ? `Retime ${ moving.length } events` : 'Retime event' );
			else if ( collapseOnClick ) setSelection( [ ev.id ] ); // a plain click on a selected block narrows the selection to it

		}

		document.addEventListener( 'mousemove', onMove );
		document.addEventListener( 'mouseup', onUp );

	}

	function startResize( e, ev ) {

		const lw = laneWidth(), span = viewSpan();
		const snapper = snapTargets( new Set( [ ev.id ] ) );
		const maxDist = ( SNAP_PX / lw ) * span;
		const gridStep = ui.gridUnit( span, lw );
		const el = blockEls.get( ev.id );
		const startX = e.clientX;
		let nextDur = ev.dur;

		function measure( me ) {

			let d = Math.max( 0, ev.dur + ( ( me.clientX - startX ) / lw ) * span );
			let guide = null;
			if ( ! me.altKey ) {

				const s = view.snapEdge( snapper, ev.at + d, maxDist );
				if ( s.guide !== null ) { d = Math.max( 0, s.time - ev.at ); guide = s.guide; }
				else if ( gridSnap ) d = Math.max( 0, ui.snapToGrid( ev.at + d, gridStep ) - ev.at );

			}
			nextDur = d;
			return guide;

		}

		function onMove( me ) {

			const guide = measure( me );
			if ( el ) el.style.width = Math.max( MIN_BLOCK_PX, ( nextDur / span ) * lw ) + 'px';
			showSnapGuide( guide );

		}

		function onUp( ue ) {

			document.removeEventListener( 'mousemove', onMove );
			document.removeEventListener( 'mouseup', onUp );
			showSnapGuide( null );
			measure( ue );
			if ( Math.abs( nextDur - ev.dur ) > 0.0005 ) commitMutation( m => m.resizeEvent( ev.id, round3( nextDur ) ), 'Resize event' ); // a plain click on the grip only selects

		}

		document.addEventListener( 'mousemove', onMove );
		document.addEventListener( 'mouseup', onUp );

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

		if ( ! selectedIds.size ) return;
		const ids = [ ...selectedIds ];
		setSelection( [] );
		commitMutation( m => { for ( const id of ids ) m.removeEvent( id ); }, ids.length > 1 ? `Delete ${ ids.length } events` : 'Delete event' ); // one undo step

	}

	// ── Playback / scrubbing (the ONE clock) ──────────────────────────────────
	function sampleAt( time ) {

		if ( ! ( totalDuration() > 0 ) ) return;
		holdTimelineAt( editor, time ); // paused, never stopped — no restoreOriginalState() snap-back
		signals.sceneGraphChanged.dispatch();

	}

	function play() {

		// ONE sampler drives everything: each tick poses the authored timeline AND
		// every imported clip (through its play/pause/stop/seek directives) from the
		// playhead via holdTimelineAt — the same path scrub and the Render tab use,
		// so live playback cannot drift from what gets exported.
		if ( ! ( totalDuration() > 0 ) ) return;

		if ( playhead >= totalDuration() ) playhead = 0; // parked at the end: replay from the top
		tickLastTime = null;
		playing = true;

	}

	function pause() {

		if ( ! playing ) return;

		playing = false;
		holdTimelineAt( editor, playhead ); // hold, don't stop — pose stays put
		// Keep the viewport on the shot camera so the paused frame stays on
		// screen to edit against; Stop (or unticking Follow) is what returns to
		// the Edit Camera.
		applyFollowCamera();
		updatePlayheadUI();

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
		// While a paused frame is held on a shot camera, scrubbing keeps that
		// view in step with the playhead (a manual camera change is left alone).
		if ( followedAway && editor.viewportCamera === followedCamera ) applyFollowCamera();
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

	ruler.addEventListener( 'mousedown', function ( e ) { scrubbing = true; scrubFrom( e.clientX ); } ); // the track list's own mousedown is with the blocks'
	document.addEventListener( 'mousemove', function ( e ) { if ( scrubbing ) scrubFrom( e.clientX ); } );
	document.addEventListener( 'mouseup', function () { scrubbing = false; } );

	// ctrl / cmd + wheel (a trackpad pinch too) zooms around the cursor. Panning, when zoomed: the wheel over the
	// ruler, shift + wheel or a sideways swipe over the tracks (a plain wheel over the tracks still scrolls them).
	area.addEventListener( 'wheel', function ( e ) {

		const px = e.clientX - area.getBoundingClientRect().left - LABEL_W;
		if ( e.ctrlKey || e.metaKey ) {

			e.preventDefault();
			const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
			zoomAt( Math.exp( - dy * 0.0025 ), Math.min( Math.max( 0, px ), laneWidth() ) );
			return;

		}

		const sideways = e.shiftKey || Math.abs( e.deltaX ) > Math.abs( e.deltaY );
		if ( zoomSpan === null || ! ( sideways || ruler.contains( e.target ) ) ) return;
		e.preventDefault();
		panBy( ( e.deltaMode === 1 ? 16 : 1 ) * ( Math.abs( e.deltaX ) > Math.abs( e.deltaY ) ? e.deltaX : e.deltaY ) );

	}, { passive: false } );

	function updatePlayheadUI() {

		// playing while zoomed: turn the page when the playhead leaves the lane
		if ( playing && zoomSpan !== null ) {

			const p = timeToPx( playhead );
			if ( p < 0 || p > laneWidth() ) {

				viewStart = view.clampView( playhead - zoomSpan * 0.1, zoomSpan, viewDuration() ).start;
				render();

			}

		}

		const lw = laneWidth(), px = timeToPx( playhead );
		playheadEl.style.display = px >= 0 && px <= lw ? '' : 'none';
		playheadEl.style.left = ( LABEL_W + px ) + 'px';
		const dur = totalDuration();
		timeCurrent.textContent = formatClockMs( playhead );
		timeTotal.textContent = ' / ' + formatClockMs( dur );
		if ( zoomSpan !== null ) positionMiniWindow(); // the playhead mark on the overview
		deleteButton.dom.disabled = selectedIds.size === 0;
		updateAddKeyState();
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

		// face / gaze keys: one object, duration in ms like everything else at the surface
		if ( op === FT.FACE_OP || op === FT.GAZE_OP ) {

			const ms = Math.round( ( dur ?? 0 ) * 1000 );
			return fmtProps( { ...args, ...( ms ? { duration: ms } : {} ) } );

		}

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

		// Imported-clip control: .play('clip', { loop, speed, weight, fade }) / .pause('clip')
		// / .stop('clip') / .seek(time, 'clip'). Control is editable here; the clip's
		// baked keyframes are not. fade is ms at the surface (like .animate()).
		if ( op === 'play' ) {

			const o = [];
			if ( args.loop !== undefined ) o.push( `loop: ${ args.loop }` );
			if ( args.from !== undefined ) o.push( `from: ${ args.from }` );
			if ( args.to !== undefined ) o.push( `to: ${ args.to }` );
			if ( args.speed !== undefined ) o.push( `speed: ${ args.speed }` );
			if ( args.weight !== undefined ) o.push( `weight: ${ args.weight }` );
			if ( args.fade !== undefined ) o.push( `fade: ${ Math.round( args.fade * 1000 ) }` );
			if ( args.clampWhenFinished !== undefined ) o.push( `clampWhenFinished: ${ args.clampWhenFinished }` );
			return fmtVal( args.name ?? '' ) + ( o.length ? `, { ${ o.join( ', ' ) } }` : '' );

		}

		if ( op === 'pause' || op === 'stop' ) return fmtVal( args.name ?? '' );
		if ( op === 'seek' ) return `${ args.time ?? 0 }, ${ fmtVal( args.name ?? '' ) }`;

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
		const blocks = [];
		const trackBlocks = []; // for the key -> code line map: which block prints which events

		// Anything the authored directives reference that no longer resolves.
		for ( const message of editor.clipDirectiveProblems || [] ) blocks.push( `// WARNING: ${ message }` );

		// Imported clips with no directive auto-play (back-compat). Show each as the
		// editable statement it is equivalent to — control is authorable, the baked
		// tracks are not. Saving the panel turns the statement into a real directive.
		const imported = getImportedClips( editor );
		if ( imported.length ) {

			blocks.push( imported.map( c => {

				const selector = clipSelector( c );
				const note = `${ c.tracks.length } baked track${ c.tracks.length === 1 ? '' : 's' } (read-only data)`;
				if ( ! selector ) return `// "${ c.name || 'clip' }" (${ c.duration.toFixed( 2 ) }s, ${ note }) — drives no node in this scene`;
				return `$S('${ selector }').at(0).play(${ fmtVal( c.name || '' ) });   // ${ note } — plays automatically`;

			} ).join( '\n' ) );

		}

		if ( model.isEmpty() ) {

			if ( blocks.length === 0 ) blocks.push( '// timeline is empty' );

		} else {

			// Performance groups: the cut is the group's edit list, shown (and re-accepted) as one
			// `$M` line, followed by the 1-line summary of what it keeps.
			for ( const g of model.groups ) {

				const keep = g.edl ? edlDuration( g.edl ) : null;
				blocks.push( groupCommand( g ) + ( keep === null ? '   // uncut — the full capture plays' : `   // registered pair; the capture is never modified` ) );
				const cut = cutCommand( g );
				if ( cut ) blocks.push( cut + ( keep === null ? '' : `   // ${ g.edl.spans.length } span${ g.edl.spans.length === 1 ? '' : 's' }, ${ keep.toFixed( 2 ) }s` ) );

			}

			for ( const [ selector, cfg ] of Object.entries( model.faces ) ) if ( cfg.idle ) blocks.push( FT.idleCommand( selector, cfg.idle ) + '   // seeded underlayer — never baked into the keys' );

			for ( const track of model.tracks ) {

				let evs = model.sortedEvents( track ).filter( e => ! ( e.args && e.args.group ) );
				if ( evs.length === 0 ) continue;

				// A dense (baked) camera track is ONE setKeys statement, one key per line, with a comment saying so;
				// only the events that are not camera keys stay in the chain below.
				const collapsed = collapseCameraKeys( track, evs );
				if ( collapsed ) {

					trackBlocks.push( { block: blocks.length, ids: collapsed.ids, lead: collapsed.lead } );
					blocks.push( collapsed.lines.join( '\n' ) );
					evs = collapsed.rest;
					if ( evs.length === 0 ) continue;

				}

				const chain = evs.map( e => `.at(${ Math.round( e.at * 1000 ) / 1000 }).${ e.op }(${ argList( e.op, e.args, e.dur ) })` );
				let line = `$S('${ track.target }')` + ( evs.length === 1 ? chain[ 0 ] : chain.map( c => `\n  ${ c }` ).join( '' ) ) + ';';

				// Make the data/control boundary visible: control above is editable,
				// the clip's own keyframes are not.
				const names = [ ...new Set( evs.filter( e => CLIP_OPS.has( e.op ) && e.args.name ).map( e => e.args.name ) ) ];
				const notes = names.map( n => {

					const clip = importedClipsOf( editor ).find( c => c.name === n );
					return clip ? `${ clip.tracks.length } baked track${ clip.tracks.length === 1 ? '' : 's' } (read-only data)` : null;

				} ).filter( Boolean );
				if ( notes.length ) line += `   // ${ notes.join( ', ' ) }`;

				trackBlocks.push( { block: blocks.length, ids: evs.map( e => e.id ) } );
				blocks.push( line );

			}

		}

		eventLines = eventLineMap( blocks, trackBlocks );
		lineEvents = new Map( [ ...eventLines ].map( ( [ id, line ] ) => [ line, id ] ) );
		codePanel.value = blocks.join( '\n\n' );
		revealKeyInCode( true ); // setValue() resets the scroll: put the selected key's line back in view

	}

	// A selector that addresses a clip's rig root: the root's id (label, else
	// name) when that resolves back to it, otherwise its raw uuid.
	function clipSelector( clip ) {

		const root = clipRoot( editor, clip );
		if ( ! root ) return null;

		const ids = [ root.userData && root.userData.label, root.name ].filter( Boolean ).map( normalizeClassName ).filter( Boolean );
		for ( const id of ids ) {

			let hit = [];
			try { hit = selectorEngine.query( editor.scene, '#' + id ); } catch ( e ) { hit = []; }
			if ( hit.includes( root ) ) return '#' + id;

		}

		return root.uuid;

	}

	// ── Follow render camera (viewport tracks the Camera Sequence while playing) ─
	function applyFollowCamera() {

		if ( ! followRenderCamera ) return;
		const cam = activeRenderCameraAt( editor, playhead );
		if ( cam && editor.viewportCamera !== cam ) {

			editor.viewportCamera = cam;
			followedAway = true;
			followedCamera = cam;
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
	let tickLastTime = null; // wall-clock origin of the previous tick while playing

	function tick() {

		const dur = totalDuration();

		if ( playing && dur > 0 ) {

			const now = performance.now();
			if ( tickLastTime !== null ) playhead = Math.min( playhead + ( now - tickLastTime ) / 1000, dur );
			tickLastTime = now;
			if ( playhead >= dur ) playing = false; // reached the end — don't loop

			// The same sampler scrub/seek/Render use: poses the authored timeline,
			// every imported clip (via its directives), camera projections and
			// content (change()) events for this exact playhead time.
			holdTimelineAt( editor, playhead );

			updatePlayheadUI();

			applyFollowCamera();

			// This tick() loop runs independently of Viewport's own animate()
			// loop, which only calls render() while a mixer action is running
			// (plus one grace frame). The two loops can settle a
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
		if ( ! selectedIds.size ) return;
		if ( container.dom.offsetParent === null ) return; // tab not visible
		const tag = e.target && e.target.tagName;
		if ( tag === 'INPUT' || tag === 'TEXTAREA' ) return;

		e.preventDefault();
		e.stopPropagation();
		deleteSelected();

	}, true );

	// Esc closes the key options (it deselects the key). Not while the code editor has the focus: there Esc belongs to Monaco.
	document.addEventListener( 'keydown', function ( e ) {

		if ( e.key !== 'Escape' || ! selectedIds.size || container.dom.offsetParent === null ) return;
		if ( monacoCodeEditor && monacoCodeEditor.hasTextFocus() ) return;
		closeKeyPopover();

	} );

	// The popover is anchored to a block: follow it when any ancestor (the sidebar, the track list) scrolls.
	document.addEventListener( 'scroll', positionKeyPopover, true );

	// ── Signals ───────────────────────────────────────────────────────────────
	signals.timelineChanged.add( function () { render(); renderCode(); refreshCamRow(); } );
	signals.cameraPathChanged.add( function () { refreshCamRow(); revealKeyInCode( false ); } ); // a key picked on the camera path in the viewport
	// Imported clips (e.g. a glTF/GLB import) land on editor.scene.animations
	// outside the TimelineModel, dispatched via animationsChanged — refresh the
	// tab so the new clip's row/duration/code comment show up immediately.
	signals.animationsChanged.add( function () { render(); renderCode(); } );
	// Undo/redo of an imported-clip delete swaps scene.animations via SetValueCommand,
	// which only announces objectChanged.
	signals.objectChanged.add( function ( object ) { if ( object === editor.scene ) { render(); renderCode(); } } );
	signals.editorCleared.add( function () { playing = false; playhead = 0; setSelection( [], true ); fitView(); } );
	signals.objectSelected.add( function () { setSelection( [], true ); refreshKeyPanel(); } );
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
		else positionKeyPopover(); // the tab went away: take the popover with it

	} ).observe( area );

	render();
	refreshCode();

	return container;

}

export { Timeline };
