import * as THREE from 'three';

import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ColorEnvironment } from 'three/addons/environments/ColorEnvironment.js';

import { UIPanel, UIRow, UIText, UIButton, UISelect, UINumber, UICheckbox, UITextArea } from './libs/ui.js';
import { holdTimelineAt } from './intelligence/timelineController.js';
import { findCallcards, refreshCallcard } from './Callcard.js';

// ── SRT helpers (parse / format / word-wrap for hard-burn) ─────────────────

function formatSrtTime( seconds ) {

	seconds = Math.max( 0, seconds );
	const h = Math.floor( seconds / 3600 );
	const m = Math.floor( ( seconds % 3600 ) / 60 );
	const s = Math.floor( seconds % 60 );
	const ms = Math.round( ( seconds - Math.floor( seconds ) ) * 1000 );
	const pad = ( n, len ) => String( n ).padStart( len || 2, '0' );
	return `${ pad( h ) }:${ pad( m ) }:${ pad( s ) },${ pad( ms, 3 ) }`;

}

function parseSrtTime( str ) {

	const m = str.trim().match( /(\d+):(\d{2}):(\d{2})[,.](\d{3})/ );
	if ( ! m ) return 0;
	return ( + m[ 1 ] ) * 3600 + ( + m[ 2 ] ) * 60 + ( + m[ 3 ] ) + ( + m[ 4 ] ) / 1000;

}

function newCueId() {

	return 'cue-' + Math.random().toString( 36 ).slice( 2, 9 );

}

/** Parse raw .srt text into { id, start, end, text } cues (index lines optional/ignored, re-numbered on export). */
function parseSrt( text ) {

	const blocks = String( text ).replace( /\r/g, '' ).split( /\n\s*\n/ ).map( b => b.trim() ).filter( Boolean );
	const cues = [];

	for ( const block of blocks ) {

		const lines = block.split( '\n' );
		let idx = 0;
		if ( /^\d+$/.test( ( lines[ 0 ] || '' ).trim() ) ) idx = 1;
		const timeLine = lines[ idx ] || '';
		const m = timeLine.match( /(.+?)\s*-->\s*(.+)/ );
		if ( ! m ) continue;

		cues.push( {
			id: newCueId(),
			start: parseSrtTime( m[ 1 ] ),
			end: parseSrtTime( m[ 2 ] ),
			text: lines.slice( idx + 1 ).join( '\n' ).trim(),
		} );

	}

	return cues;

}

function cuesToSrt( cues ) {

	return cues
		.slice()
		.sort( ( a, b ) => a.start - b.start )
		.map( ( c, i ) => `${ i + 1 }\n${ formatSrtTime( c.start ) } --> ${ formatSrtTime( c.end ) }\n${ c.text }\n` )
		.join( '\n' );

}

function activeCueAt( cues, t ) {

	return cues.find( c => t >= c.start && t < c.end ) || null;

}

/** Word-wraps and draws one subtitle cue at the bottom of the canvas, with a translucent backing box (classic hard-burn caption look). */
function drawBurnedCaption( ctx, width, height, text ) {

	const fontSize = Math.max( 12, Math.round( height * 0.045 ) );
	ctx.save();
	ctx.font = `bold ${ fontSize }px sans-serif`;
	ctx.textAlign = 'center';
	ctx.textBaseline = 'alphabetic';

	const maxWidth = width * 0.86;
	const words = text.split( /\s+/ );
	const lines = [];
	let line = '';

	for ( const w of words ) {

		const test = line ? line + ' ' + w : w;
		if ( line && ctx.measureText( test ).width > maxWidth ) { lines.push( line ); line = w; }
		else line = test;

	}

	if ( line ) lines.push( line );

	const lineHeight = fontSize * 1.3;
	const bottomMargin = height * 0.06;
	const startY = height - bottomMargin - ( lines.length - 1 ) * lineHeight;

	let maxLineWidth = 0;
	for ( const l of lines ) maxLineWidth = Math.max( maxLineWidth, ctx.measureText( l ).width );

	const padX = fontSize * 0.6, padY = fontSize * 0.4;
	ctx.fillStyle = 'rgba(0,0,0,0.55)';
	ctx.fillRect(
		width / 2 - maxLineWidth / 2 - padX,
		startY - fontSize - padY,
		maxLineWidth + padX * 2,
		( lines.length - 1 ) * lineHeight + fontSize + padY * 2 + fontSize * 0.3
	);

	ctx.fillStyle = '#fff';
	ctx.strokeStyle = 'rgba(0,0,0,0.85)';
	ctx.lineWidth = fontSize * 0.08;

	lines.forEach( ( l, i ) => {

		const y = startY + i * lineHeight;
		ctx.strokeText( l, width / 2, y );
		ctx.fillText( l, width / 2, y );

	} );

	ctx.restore();

}

// ── Sidebar.Render.js ─────────────────────────────────────────────────────────
// The "Render" tab: renders the Universal Timeline to a video file through a
// chosen camera. Uses a dedicated offscreen WebGLRenderer (so the viewport is
// untouched), steps the ONE shared clock frame-by-frame via holdTimelineAt(),
// and captures frames with canvas.captureStream() + MediaRecorder. The loop is
// paced to wall-clock (MediaRecorder timestamps frames by real time), so the
// output video duration matches the timeline duration exactly.

function SidebarRender( editor ) {

	const signals = editor.signals;

	const container = new UIPanel();
	// NOT 'render' — the sidebar tab span itself gets id 'render' (same collision
	// rule as the Shell tab: tab id must differ from the panel's own id).
	container.setId( 'render-panel' );

	// ── Header ────────────────────────────────────────────────────────────────

	const header = new UIRow();
	header.add( new UIText( 'Video Render' ).setFontWeight( 'bold' ) );
	container.add( header );

	const help = new UIText( 'Renders the Universal Timeline to a video. Use the camera sequence below to cut/fade between cameras over time; with no shots the single camera above is used throughout.' );
	help.dom.style.cssText = 'display:block;font-size:11px;opacity:0.7;margin:0 0 10px;line-height:1.4;';
	container.add( help );

	// ── Camera ────────────────────────────────────────────────────────────────

	const cameraRow = new UIRow();
	cameraRow.add( new UIText( 'Camera' ).setClass( 'Label' ) );
	const cameraSelect = new UISelect().setWidth( '160px' );
	cameraRow.add( cameraSelect );
	container.add( cameraRow );

	function updateCameraList() {

		const options = {};
		for ( const uuid in editor.cameras ) {

			const cam = editor.cameras[ uuid ];
			options[ uuid ] = cam.name || 'Camera';

		}

		const prev = cameraSelect.getValue();
		cameraSelect.setOptions( options );
		cameraSelect.setValue( options[ prev ] !== undefined ? prev : editor.camera.uuid );

	}

	signals.cameraAdded.add( updateCameraList );
	signals.cameraRemoved.add( updateCameraList );
	signals.objectChanged.add( function ( object ) {

		if ( object && object.isCamera ) updateCameraList();

	} );
	signals.editorCleared.add( updateCameraList );
	updateCameraList();

	// ── Resolution ────────────────────────────────────────────────────────────

	const resolutionRow = new UIRow();
	resolutionRow.add( new UIText( 'Resolution' ).setClass( 'Label' ) );
	const resolutionSelect = new UISelect().setWidth( '160px' );
	resolutionSelect.setOptions( {
		'1920x1080': '1920 × 1080 (1080p)',
		'1280x720': '1280 × 720 (720p)',
		'854x480': '854 × 480 (480p)',
		'640x360': '640 × 360 (360p)',
		'1080x1080': '1080 × 1080 (square)',
	} );
	resolutionSelect.setValue( '1280x720' );
	resolutionRow.add( resolutionSelect );
	container.add( resolutionRow );

	// ── FPS ───────────────────────────────────────────────────────────────────

	const fpsRow = new UIRow();
	fpsRow.add( new UIText( 'FPS' ).setClass( 'Label' ) );
	const fpsSelect = new UISelect().setWidth( '160px' );
	fpsSelect.setOptions( { '24': '24', '30': '30', '60': '60' } );
	fpsSelect.setValue( '30' );
	fpsRow.add( fpsSelect );
	container.add( fpsRow );

	// ── Skip First (trims the render's in-point, e.g. to cut a static lead-in) ─

	const skipRow = new UIRow();
	skipRow.add( new UIText( 'Skip First' ).setClass( 'Label' ) );
	const skipSelect = new UISelect().setWidth( '160px' );
	skipSelect.setOptions( { '0': 'None', '1': '1 s', '2': '2 s', '3': '3 s', '4': '4 s', '5': '5 s' } );
	skipSelect.setValue( '0' );
	skipSelect.onChange( updateDuration );
	skipRow.add( skipSelect );
	container.add( skipRow );

	// ── Duration (from the universal timeline — read-only) ───────────────────

	// Extra time recorded after the timeline's last frame, holding it frozen —
	// gives viewers a beat to register the final state instead of the video
	// cutting off the instant the last animation ends.
	const RENDER_TAIL_SECONDS = 2;

	const durationRow = new UIRow();
	durationRow.add( new UIText( 'Duration' ).setClass( 'Label' ) );
	const durationText = new UIText( '0.00 s' );
	durationRow.add( durationText );
	container.add( durationRow );

	function timelineDuration() {

		const anims = editor.scene.animations || [];
		const clip = anims.find( c => c.userData && c.userData.isTimeline );
		if ( clip && clip.duration > 0 ) return clip.duration;
		return editor.timeline ? editor.timeline.duration : 0;

	}

	function skipSeconds( duration ) {

		return Math.min( parseFloat( skipSelect.getValue() ) || 0, duration );

	}

	function outputDuration( duration ) {

		return Math.max( 0, duration - skipSeconds( duration ) ) + RENDER_TAIL_SECONDS;

	}

	function updateDuration() {

		const d = timelineDuration();
		durationText.setValue( d > 0 ? `${ d.toFixed( 2 ) } s (renders ${ outputDuration( d ).toFixed( 2 ) } s)` : 'Timeline is empty' );
		renderButton.dom.disabled = ( d <= 0 ) || rendering;
		equirectButton.dom.disabled = ( d <= 0 ) || rendering;

	}

	signals.timelineChanged.add( updateDuration );
	signals.animationsChanged.add( updateDuration );
	signals.editorCleared.add( updateDuration );

	// ── Camera sequence (shots + transitions) ─────────────────────────────────
	// Persisted in scene.userData.renderShots (same versioning path as the
	// timeline model). A shot = { id, at, camera:uuid, transition:'cut'|'fade',
	// transitionDur }. A shot runs from its `at` until the next shot's `at` (or
	// the timeline end); `transition` describes how the shot is ENTERED.

	const seqHeader = new UIRow();
	seqHeader.add( new UIText( 'Camera Sequence' ).setFontWeight( 'bold' ) );
	container.add( seqHeader );

	const seqLane = document.createElement( 'div' );
	seqLane.style.cssText = 'position:relative;height:34px;border:1px solid rgba(128,128,128,0.4);border-radius:4px;background:rgba(128,128,128,0.12);margin:4px 0 6px;overflow:hidden;';
	container.dom.appendChild( seqLane );

	const seqControls = document.createElement( 'div' );
	seqControls.style.cssText = 'margin-bottom:8px;';
	container.dom.appendChild( seqControls );

	const addShotButton = new UIButton( '+ Add Shot' );
	addShotButton.dom.style.cssText = 'height:22px;padding:0 8px;border-radius:4px;font-size:11px;';
	addShotButton.onClick( addShot );
	seqControls.appendChild( addShotButton.dom );

	const shotDetail = document.createElement( 'div' );
	shotDetail.style.cssText = 'margin-top:6px;display:none;';
	seqControls.appendChild( shotDetail );

	let selectedShotId = null;

	function getShots() {

		const ud = editor.scene.userData = editor.scene.userData || {};
		if ( ! Array.isArray( ud.renderShots ) ) ud.renderShots = [];
		ud.renderShots.sort( ( a, b ) => a.at - b.at );
		return ud.renderShots;

	}

	function cameraOf( shot ) {

		return ( shot && editor.cameras[ shot.camera ] ) || editor.camera;

	}

	function addShot() {

		const shots = getShots();
		const dur = Math.max( timelineDuration(), 1 );
		const lastAt = shots.length ? shots[ shots.length - 1 ].at : - 1;
		const at = shots.length === 0 ? 0 : Math.min( dur - 0.1, lastAt + Math.max( 0.5, ( dur - lastAt ) / 2 ) );
		const shot = {
			id: 'shot-' + Math.random().toString( 36 ).slice( 2, 9 ),
			at: Math.max( 0, at ),
			camera: cameraSelect.getValue() || editor.camera.uuid,
			transition: shots.length === 0 ? 'cut' : 'fade',
			transitionDur: 0.5,
		};
		shots.push( shot );
		selectedShotId = shot.id;
		refreshSequencer();

	}

	function refreshSequencer() {

		const shots = getShots();
		const dur = Math.max( timelineDuration(), 0.001 );
		seqLane.innerHTML = '';

		if ( shots.length === 0 ) {

			const empty = document.createElement( 'div' );
			empty.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:10px;opacity:0.55;';
			empty.textContent = 'No shots — single camera render';
			seqLane.appendChild( empty );
			shotDetail.style.display = 'none';
			return;

		}

		const COLORS = [ '#3b82c4', '#c46a3b', '#5aa860', '#9a5ac4', '#c4b23b', '#c45a7a' ];

		for ( let i = 0; i < shots.length; i ++ ) {

			const shot = shots[ i ];
			const end = i + 1 < shots.length ? shots[ i + 1 ].at : dur;
			const left = ( shot.at / dur ) * 100;
			const width = Math.max( 0.5, ( ( end - shot.at ) / dur ) * 100 );

			const block = document.createElement( 'div' );
			const selected = shot.id === selectedShotId;
			block.style.cssText = `position:absolute;top:2px;bottom:2px;left:${ left }%;width:${ width }%;background:${ COLORS[ i % COLORS.length ] };border-radius:3px;cursor:${ i === 0 ? 'pointer' : 'ew-resize' };overflow:hidden;white-space:nowrap;font-size:10px;color:#fff;display:flex;align-items:center;padding:0 5px;box-sizing:border-box;${ selected ? 'outline:2px solid #08f;outline-offset:-2px;' : 'opacity:0.85;' }`;
			block.title = `${ cameraOf( shot ).name || 'Camera' } @ ${ shot.at.toFixed( 2 ) }s (${ shot.transition }${ shot.transition === 'fade' ? ' ' + shot.transitionDur + 's' : '' })`;
			block.textContent = ( shot.transition === 'fade' && i > 0 ? '◤ ' : '' ) + ( cameraOf( shot ).name || 'Camera' );
			seqLane.appendChild( block );

			block.addEventListener( 'pointerdown', ( e ) => {

				e.preventDefault();
				selectedShotId = shot.id;
				refreshSequencer();

				if ( i === 0 ) return; // first shot is pinned to t=0

				const startX = e.clientX;
				const startAt = shot.at;
				const laneW = seqLane.getBoundingClientRect().width;
				const minAt = shots[ i - 1 ].at + 0.05;
				const maxAt = ( i + 1 < shots.length ? shots[ i + 1 ].at : dur ) - 0.05;

				function onMove( me ) {

					shot.at = Math.min( maxAt, Math.max( minAt, startAt + ( ( me.clientX - startX ) / laneW ) * dur ) );
					refreshSequencer();

				}

				function onUp() {

					window.removeEventListener( 'pointermove', onMove );
					window.removeEventListener( 'pointerup', onUp );
					refreshSequencer();

				}

				window.addEventListener( 'pointermove', onMove );
				window.addEventListener( 'pointerup', onUp );

			} );

		}

		refreshShotDetail();

	}

	function refreshShotDetail() {

		const shots = getShots();
		const shot = shots.find( s => s.id === selectedShotId );
		shotDetail.innerHTML = '';

		if ( ! shot ) {

			shotDetail.style.display = 'none';
			return;

		}

		shotDetail.style.display = '';
		const index = shots.indexOf( shot );

		const row = document.createElement( 'div' );
		row.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:11px;';
		shotDetail.appendChild( row );

		// camera picker
		const camSel = new UISelect().setWidth( '110px' );
		const camOptions = {};
		for ( const uuid in editor.cameras ) camOptions[ uuid ] = editor.cameras[ uuid ].name || 'Camera';
		camSel.setOptions( camOptions );
		camSel.setValue( shot.camera );
		camSel.onChange( function () { shot.camera = this.getValue(); refreshSequencer(); } );
		row.appendChild( camSel.dom );

		// start time (first shot pinned to 0)
		const atLabel = document.createElement( 'span' );
		atLabel.textContent = 'at';
		row.appendChild( atLabel );
		const atNum = new UINumber( shot.at ).setWidth( '44px' ).setPrecision( 2 ).setRange( 0, 10000 );
		atNum.dom.style.pointerEvents = index === 0 ? 'none' : '';
		atNum.onChange( function () {

			if ( index === 0 ) { atNum.setValue( 0 ); return; }
			const minAt = shots[ index - 1 ].at + 0.05;
			const maxAt = ( index + 1 < shots.length ? shots[ index + 1 ].at : timelineDuration() ) - 0.05;
			shot.at = Math.min( maxAt, Math.max( minAt, atNum.getValue() ) );
			refreshSequencer();

		} );
		row.appendChild( atNum.dom );

		// transition (only meaningful from the 2nd shot on)
		if ( index > 0 ) {

			const transSel = new UISelect().setWidth( '64px' );
			transSel.setOptions( { 'cut': 'cut', 'fade': 'fade' } );
			transSel.setValue( shot.transition || 'cut' );
			transSel.onChange( function () { shot.transition = this.getValue(); refreshSequencer(); } );
			row.appendChild( transSel.dom );

			const fadeNum = new UINumber( shot.transitionDur || 0.5 ).setWidth( '38px' ).setPrecision( 2 ).setRange( 0.05, 30 );
			fadeNum.dom.title = 'Fade duration (s)';
			fadeNum.dom.style.display = ( shot.transition === 'fade' ) ? '' : 'none';
			fadeNum.onChange( function () { shot.transitionDur = fadeNum.getValue(); refreshSequencer(); } );
			row.appendChild( fadeNum.dom );

		}

		const delBtn = new UIButton( 'Delete' );
		delBtn.dom.style.cssText = 'height:20px;padding:0 8px;border-radius:4px;font-size:10px;';
		delBtn.onClick( function () {

			shots.splice( shots.indexOf( shot ), 1 );
			if ( shots.length > 0 ) shots[ 0 ].at = 0; // keep the first shot pinned
			selectedShotId = null;
			refreshSequencer();

		} );
		row.appendChild( delBtn.dom );

	}

	// Cheap + debounced: covers load (setScene), camera renames, timeline edits.
	let seqRefreshTimer = null;
	function scheduleSeqRefresh() {

		clearTimeout( seqRefreshTimer );
		seqRefreshTimer = setTimeout( refreshSequencer, 200 );

	}

	signals.timelineChanged.add( scheduleSeqRefresh );
	signals.cameraAdded.add( scheduleSeqRefresh );
	signals.cameraRemoved.add( scheduleSeqRefresh );
	signals.editorCleared.add( scheduleSeqRefresh );
	signals.sceneGraphChanged.add( scheduleSeqRefresh );

	// ── Subtitles (SRT) ───────────────────────────────────────────────────────
	// Cues persist on scene.userData.renderSubtitles (same pattern as
	// renderShots). Times are authored in OUTPUT VIDEO seconds (0 = the
	// exported file's first frame) — that's what an .srt's timestamps mean to
	// any player, so no skip/tail conversion is needed at render time.

	const subsHeader = new UIRow();
	subsHeader.add( new UIText( 'Subtitles' ).setFontWeight( 'bold' ) );
	container.add( subsHeader );

	const subsHelp = new UIText( 'Cue times are OUTPUT video seconds. Hard-burn bakes them into the picture; the .srt sidecar is for embedding downstream (e.g. via ffmpeg).' );
	subsHelp.dom.style.cssText = 'display:block;font-size:10px;opacity:0.65;margin:0 0 6px;line-height:1.35;';
	container.add( subsHelp );

	const subsList = document.createElement( 'div' );
	subsList.style.cssText = 'display:flex;flex-direction:column;gap:4px;max-height:200px;overflow-y:auto;margin-bottom:6px;';
	container.dom.appendChild( subsList );

	function getCues() {

		const ud = editor.scene.userData = editor.scene.userData || {};
		if ( ! Array.isArray( ud.renderSubtitles ) ) ud.renderSubtitles = [];
		return ud.renderSubtitles;

	}

	function refreshSubsList() {

		const cues = getCues().slice().sort( ( a, b ) => a.start - b.start );
		subsList.innerHTML = '';

		if ( cues.length === 0 ) {

			const empty = document.createElement( 'div' );
			empty.style.cssText = 'font-size:10px;opacity:0.55;padding:2px 0 4px;';
			empty.textContent = 'No cues yet — Add Cue or Import .srt.';
			subsList.appendChild( empty );

		}

		for ( const cue of cues ) {

			const row = document.createElement( 'div' );
			row.style.cssText = 'display:flex;align-items:flex-start;gap:4px;';
			subsList.appendChild( row );

			const startNum = new UINumber( cue.start ).setWidth( '46px' ).setPrecision( 2 ).setRange( 0, 100000 );
			startNum.dom.title = 'Start (s)';
			startNum.onChange( function () { cue.start = startNum.getValue(); } );
			row.appendChild( startNum.dom );

			const arrow = document.createElement( 'span' );
			arrow.textContent = '\u2192';
			arrow.style.cssText = 'font-size:10px;opacity:0.6;padding-top:4px;';
			row.appendChild( arrow );

			const endNum = new UINumber( cue.end ).setWidth( '46px' ).setPrecision( 2 ).setRange( 0, 100000 );
			endNum.dom.title = 'End (s)';
			endNum.onChange( function () { cue.end = endNum.getValue(); } );
			row.appendChild( endNum.dom );

			const textArea = new UITextArea().setValue( cue.text );
			textArea.dom.rows = 1;
			textArea.dom.style.cssText += 'flex:1;font-size:11px;resize:vertical;min-height:20px;';
			textArea.onChange( function () { cue.text = textArea.getValue(); } );
			row.appendChild( textArea.dom );

			const delBtn = new UIButton( '\u2715' );
			delBtn.dom.style.cssText = 'height:20px;width:20px;padding:0;border-radius:4px;font-size:10px;flex-shrink:0;';
			delBtn.onClick( function () {

				const cues2 = getCues();
				const i = cues2.indexOf( cue );
				if ( i !== - 1 ) cues2.splice( i, 1 );
				refreshSubsList();

			} );
			row.appendChild( delBtn.dom );

		}

	}

	const subsControls = document.createElement( 'div' );
	subsControls.style.cssText = 'display:flex;gap:6px;margin-bottom:6px;flex-wrap:wrap;';
	container.dom.appendChild( subsControls );

	const addCueButton = new UIButton( '+ Add Cue' );
	addCueButton.dom.style.cssText = 'height:22px;padding:0 8px;border-radius:4px;font-size:11px;';
	addCueButton.onClick( function () {

		const cues = getCues();
		const lastEnd = cues.length ? Math.max( ...cues.map( c => c.end ) ) : 0;
		cues.push( { id: newCueId(), start: lastEnd, end: lastEnd + 3, text: '' } );
		refreshSubsList();

	} );
	subsControls.appendChild( addCueButton.dom );

	const importSrtInput = document.createElement( 'input' );
	importSrtInput.type = 'file';
	importSrtInput.accept = '.srt';
	importSrtInput.style.display = 'none';
	container.dom.appendChild( importSrtInput );
	importSrtInput.addEventListener( 'change', function () {

		const file = importSrtInput.files[ 0 ];
		if ( ! file ) return;
		const reader = new FileReader();
		reader.onload = function () {

			const ud = editor.scene.userData = editor.scene.userData || {};
			ud.renderSubtitles = parseSrt( String( reader.result ) );
			refreshSubsList();

		};

		reader.readAsText( file );
		importSrtInput.value = '';

	} );

	const importSrtButton = new UIButton( 'Import .srt' );
	importSrtButton.dom.style.cssText = 'height:22px;padding:0 8px;border-radius:4px;font-size:11px;';
	importSrtButton.onClick( function () { importSrtInput.click(); } );
	subsControls.appendChild( importSrtButton.dom );

	const exportSrtButton = new UIButton( 'Export .srt' );
	exportSrtButton.dom.style.cssText = 'height:22px;padding:0 8px;border-radius:4px;font-size:11px;';
	exportSrtButton.onClick( function () {

		downloadBlob( new Blob( [ cuesToSrt( getCues() ) ], { type: 'text/plain' } ), 'subtitles.srt' );

	} );
	subsControls.appendChild( exportSrtButton.dom );

	const burnRow = new UIRow();
	const burnCheckbox = new UICheckbox( false );
	burnRow.add( burnCheckbox );
	burnRow.add( new UIText( ' Hard-burn subtitles into video' ).setFontSize( '11px' ) );
	container.add( burnRow );

	const sidecarRow = new UIRow();
	const sidecarCheckbox = new UICheckbox( true );
	sidecarRow.add( sidecarCheckbox );
	sidecarRow.add( new UIText( ' Also export a matching .srt file' ).setFontSize( '11px' ) );
	container.add( sidecarRow );

	refreshSubsList();

	// ── 360 (equirectangular) video ────────────────────────────────────────────
	// Reuses the Camera/FPS/Skip/shot-sequence/subtitle settings above — only
	// the output resolution differs (must be 2:1 for a standard equirect video).
	// The shot sequence's cameras contribute POSITION only; orientation and FOV
	// are meaningless for a 360 video (the viewer looks in every direction), so
	// no camera-aspect pinning happens for this mode.

	const equirectRow = new UIRow();
	equirectRow.add( new UIText( '360 Resolution' ).setClass( 'Label' ) );
	const equirectResolutionSelect = new UISelect().setWidth( '160px' );
	equirectResolutionSelect.setOptions( {
		'3840x1920': '3840 × 1920 (2:1)',
		'2560x1280': '2560 × 1280 (2:1)',
		'1920x960': '1920 × 960 (2:1)',
		'1280x640': '1280 × 640 (2:1)',
	} );
	equirectResolutionSelect.setValue( '1920x960' );
	equirectRow.add( equirectResolutionSelect );
	container.add( equirectRow );

	const equirectHelp = new UIText( 'Renders a 360\u00b0 equirectangular video from the camera(s) above\u2019s POSITION at each moment — pan the camera through the scene (or cut/fade between shot positions) to move the 360 viewpoint over time.' );
	equirectHelp.dom.style.cssText = 'display:block;font-size:11px;opacity:0.7;margin:0 0 10px;line-height:1.4;';
	container.add( equirectHelp );

	// ── Render / Cancel buttons ───────────────────────────────────────────────

	const buttonRow = new UIRow();

	const renderButton = new UIButton( 'Render & Export' );
	renderButton.dom.style.cssText = 'padding:6px 14px;border-radius:4px;font-weight:bold;';
	renderButton.onClick( function () { startRender( 'flat' ); } );
	buttonRow.add( renderButton );

	const equirectButton = new UIButton( 'Render 360 Video' );
	equirectButton.dom.style.cssText = 'padding:6px 14px;border-radius:4px;font-weight:bold;margin-left:6px;';
	equirectButton.onClick( function () { startRender( '360' ); } );
	buttonRow.add( equirectButton );

	const cancelButton = new UIButton( 'Cancel' );
	cancelButton.dom.style.cssText = 'padding:6px 14px;border-radius:4px;margin-left:6px;display:none;';
	cancelButton.onClick( function () { cancelRequested = true; } );
	buttonRow.add( cancelButton );

	container.add( buttonRow );

	// ── Progress bar + status ─────────────────────────────────────────────────

	const progressOuter = document.createElement( 'div' );
	progressOuter.style.cssText = 'height:8px;background:rgba(128,128,128,0.25);border-radius:4px;overflow:hidden;margin:10px 0 4px;display:none;';
	const progressInner = document.createElement( 'div' );
	progressInner.style.cssText = 'height:100%;width:0%;background:#08f;transition:width 0.1s linear;';
	progressOuter.appendChild( progressInner );
	container.dom.appendChild( progressOuter );

	const statusText = document.createElement( 'div' );
	statusText.style.cssText = 'font-size:11px;opacity:0.75;min-height:16px;margin-bottom:8px;';
	container.dom.appendChild( statusText );

	// Separate from statusText (setProgress() overwrites that via textContent
	// every call, which would wipe out any buttons appended into it).
	const postRenderActions = document.createElement( 'div' );
	postRenderActions.style.cssText = 'margin-bottom:8px;';
	container.dom.appendChild( postRenderActions );

	function setProgress( fraction, message ) {

		progressOuter.style.display = '';
		progressInner.style.width = ( Math.max( 0, Math.min( 1, fraction ) ) * 100 ).toFixed( 1 ) + '%';
		statusText.textContent = message || '';
		updateRenderOverlay( fraction, message );

	}

	// ── Viewport overlay (mirrors the sidebar progress bar, but over the 3D
	// view itself, since the sidebar can be scrolled out of sight / collapsed
	// while a render runs) ─────────────────────────────────────────────────────

	const renderOverlay = document.createElement( 'div' );
	renderOverlay.id = 'render-progress-overlay';
	renderOverlay.style.cssText = 'position:absolute;inset:0;z-index:90;display:none;' +
		'flex-direction:column;align-items:center;justify-content:center;gap:12px;' +
		'background:rgba(20,20,20,0.75);color:#eee;' +
		'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;' +
		'text-align:center;padding:24px;box-sizing:border-box;pointer-events:none;';
	renderOverlay.innerHTML =
		'<div style="font-size:14px;font-weight:bold;">Rendering\u2026</div>' +
		'<div style="width:min(320px,70%);height:10px;background:rgba(255,255,255,0.15);border-radius:5px;overflow:hidden;">' +
			'<div class="bar" style="height:100%;width:0%;background:#08f;transition:width 0.1s linear;"></div>' +
		'</div>' +
		'<div class="label" style="font-size:12px;opacity:0.85;max-width:360px;"></div>';

	function showRenderOverlay() {

		const viewport = document.getElementById( 'viewport' );
		if ( viewport && renderOverlay.parentNode !== viewport ) viewport.appendChild( renderOverlay );
		renderOverlay.style.display = 'flex';

	}

	function hideRenderOverlay() {

		renderOverlay.style.display = 'none';

	}

	function updateRenderOverlay( fraction, message ) {

		renderOverlay.querySelector( '.bar' ).style.width = ( Math.max( 0, Math.min( 1, fraction ) ) * 100 ).toFixed( 1 ) + '%';
		renderOverlay.querySelector( '.label' ).textContent = message || '';

	}

	// ── Live preview area ─────────────────────────────────────────────────────

	const previewWrap = document.createElement( 'div' );
	previewWrap.style.cssText = 'margin-top:6px;border:1px solid rgba(128,128,128,0.35);border-radius:4px;overflow:hidden;display:none;line-height:0;';
	container.dom.appendChild( previewWrap );

	// ── Render pipeline ───────────────────────────────────────────────────────

	let rendering = false;
	let cancelRequested = false;

	function pickMimeType() {

		const candidates = [
			'video/mp4;codecs=avc1.42E01E',
			'video/mp4',
			'video/webm;codecs=vp9',
			'video/webm;codecs=vp8',
			'video/webm',
		];
		for ( const m of candidates ) {

			if ( window.MediaRecorder && MediaRecorder.isTypeSupported( m ) ) return m;

		}

		return '';

	}

	function extensionFor( mime ) {

		return mime.indexOf( 'mp4' ) !== - 1 ? 'mp4' : 'webm';

	}

	function sleep( ms ) {

		return new Promise( resolve => setTimeout( resolve, ms ) );

	}

	function downloadBlob( blob, filename ) {

		const url = URL.createObjectURL( blob );
		const a = document.createElement( 'a' );
		a.href = url;
		a.download = filename;
		a.click();
		setTimeout( () => URL.revokeObjectURL( url ), 5000 );

	}

	async function startRender( kind = 'flat' ) {

		if ( rendering ) return;

		const is360 = kind === '360';

		const duration = timelineDuration();
		if ( ! ( duration > 0 ) ) {

			setProgress( 0, 'Timeline is empty — nothing to render.' );
			return;

		}

		const mime = pickMimeType();
		if ( ! mime ) {

			setProgress( 0, 'MediaRecorder video capture is not supported in this browser.' );
			return;

		}

		const shots = getShots().slice();
		const fallbackCamera = editor.cameras[ cameraSelect.getValue() ] || editor.camera;
		const [ width, height ] = ( is360 ? equirectResolutionSelect : resolutionSelect ).getValue().split( 'x' ).map( Number );
		const fps = parseInt( fpsSelect.getValue(), 10 );
		const skip = skipSeconds( duration );
		const renderLength = outputDuration( duration );

		rendering = true;
		cancelRequested = false;
		renderButton.dom.disabled = true;
		equirectButton.dom.disabled = true;
		cancelButton.dom.style.display = '';
		showRenderOverlay();

		// Two canvases: WebGL renders offscreen, a 2D canvas composites (needed
		// for crossfades: draw shot A, then shot B on top with globalAlpha) and is
		// the captureStream() source + live preview.
		const glCanvas = document.createElement( 'canvas' );
		glCanvas.width = width;
		glCanvas.height = height;

		const outCanvas = document.createElement( 'canvas' );
		outCanvas.width = width;
		outCanvas.height = height;
		outCanvas.style.cssText = 'width:100%;height:auto;display:block;';
		const ctx = outCanvas.getContext( '2d' );
		previewWrap.innerHTML = '';
		previewWrap.appendChild( outCanvas );
		previewWrap.style.display = '';

		const renderer = new THREE.WebGLRenderer( { canvas: glCanvas, antialias: true, preserveDrawingBuffer: true } );
		renderer.setPixelRatio( 1 );
		renderer.setSize( width, height, false );
		renderer.setClearColor( 0xaaaaaa ); // same base as the viewport; scene.background overrides

		// Mirror the project renderer settings (shadows / tone mapping) so the
		// output matches what the viewport shows.
		const config = editor.config;
		renderer.shadowMap.enabled = config.getKey( 'project/renderer/shadows' ) !== false;
		renderer.shadowMap.type = parseFloat( config.getKey( 'project/renderer/shadowType' ) ) || THREE.PCFShadowMap;
		renderer.toneMapping = parseFloat( config.getKey( 'project/renderer/toneMapping' ) ) || THREE.NoToneMapping;
		renderer.toneMappingExposure = parseFloat( config.getKey( 'project/renderer/toneMappingExposure' ) ) || 1;

		// The viewport's PMREM environment is a render-target texture bound to the
		// VIEWPORT's WebGL context — it cannot upload into this renderer, so PBR
		// materials would render black ("no colors"). Regenerate an equivalent
		// environment in THIS context and restore the original afterwards.
		const scene = editor.scene;
		let restoreEnvironment = function () {};
		if ( scene.environment && scene.environment.isRenderTargetTexture ) {

			const pmrem = new THREE.PMREMGenerator( renderer );
			const envScene = ( scene.background && scene.background.isColor )
				? new ColorEnvironment( scene.background )
				: new RoomEnvironment();
			const envRT = pmrem.fromScene( envScene, 0.04 );
			const prevEnv = scene.environment;
			scene.environment = envRT.texture;
			restoreEnvironment = function () {

				scene.environment = prevEnv;
				envRT.dispose();
				pmrem.dispose();

			};

		}

		// Set the render aspect on EVERY camera used (sequence + fallback),
		// restore all afterwards. Skipped for 360: a cube capture always covers
		// the full surrounding sphere regardless of any camera's aspect/FOV, so
		// there is nothing meaningful to pin.
		const aspect = width / height;
		const cameraRestores = [];
		if ( ! is360 ) {

			const camerasUsed = new Set( [ fallbackCamera ] );
			for ( const s of shots ) camerasUsed.add( cameraOf( s ) );
			for ( const cam of camerasUsed ) {

				if ( cam.isPerspectiveCamera ) {

					const prevAspect = cam.aspect;
					cam.aspect = aspect;
					cam.updateProjectionMatrix();
					cameraRestores.push( () => { cam.aspect = prevAspect; cam.updateProjectionMatrix(); } );

				} else if ( cam.isOrthographicCamera ) {

					const prev = { left: cam.left, right: cam.right };
					cam.left = - aspect;
					cam.right = aspect;
					cam.updateProjectionMatrix();
					cameraRestores.push( () => { cam.left = prev.left; cam.right = prev.right; cam.updateProjectionMatrix(); } );

				}

			}

		}

		// 360 mode: each frame, bake the scene surrounding the active camera's
		// POSITION into a cube render target (world-axis-aligned faces), then
		// re-project that cube map onto an equirectangular (2:1) quad with a
		// small shader — the standard "360 photo/video" capture technique. The
		// source camera's ORIENTATION only rotates which part of the equirect
		// image reads as "forward" (u=0.5); the capture itself always covers the
		// full sphere regardless.
		let cubeCamera = null, cubeRenderTarget = null, equirectMaterial = null, quadScene = null, quadCamera = null, quadGeometry = null;
		const basisMatrix = new THREE.Matrix3();
		const scratchPos = new THREE.Vector3();

		if ( is360 ) {

			const faceSize = Math.min( 2048, Math.max( 256, Math.round( height ) ) );
			cubeRenderTarget = new THREE.WebGLCubeRenderTarget( faceSize );
			cubeCamera = new THREE.CubeCamera( 0.05, 2000, cubeRenderTarget );

			equirectMaterial = new THREE.ShaderMaterial( {
				uniforms: {
					tCube: { value: cubeRenderTarget.texture },
					uBasis: { value: basisMatrix },
				},
				vertexShader: `
					varying vec2 vUv;
					void main() {
						vUv = uv;
						gl_Position = vec4( position.xy, 0.0, 1.0 );
					}
				`,
				fragmentShader: `
					uniform samplerCube tCube;
					uniform mat3 uBasis;
					varying vec2 vUv;
					void main() {
						float theta = ( vUv.x - 0.5 ) * 6.28318530718;
						float phi = ( vUv.y - 0.5 ) * 3.14159265359;
						vec3 localDir = vec3( sin( theta ) * cos( phi ), sin( phi ), - cos( theta ) * cos( phi ) );
						gl_FragColor = textureCube( tCube, uBasis * localDir );
					}
				`,
				depthTest: false,
				depthWrite: false,
			} );

			quadGeometry = new THREE.PlaneGeometry( 2, 2 );
			const quadMesh = new THREE.Mesh( quadGeometry, equirectMaterial );
			quadMesh.frustumCulled = false; // vertex shader writes clip space directly; culling against quadCamera would be meaningless
			quadScene = new THREE.Scene();
			quadScene.add( quadMesh );
			quadCamera = new THREE.OrthographicCamera( - 1, 1, 1, - 1, 0, 10 );
			quadCamera.position.z = 1;

		}

		function renderEquirectFace( cam ) {

			cam.updateWorldMatrix( true, false );
			cubeCamera.position.copy( cam.getWorldPosition( scratchPos ) );
			cubeCamera.update( renderer, scene );
			basisMatrix.setFromMatrix4( cam.matrixWorld );
			renderer.setRenderTarget( null );
			renderer.render( quadScene, quadCamera );

		}

		// Which camera(s) drive the frame at time t: current shot, plus the
		// previous shot's camera while inside a fade window (blend 0→1).
		function shotStateAt( t ) {

			if ( shots.length === 0 ) return { camera: fallbackCamera, from: null, blend: 1 };
			let i = shots.length - 1;
			while ( i > 0 && shots[ i ].at > t ) i --;
			const cur = shots[ i ];
			const prev = i > 0 ? shots[ i - 1 ] : null;
			if ( prev && cur.transition === 'fade' && cur.transitionDur > 0 && t < cur.at + cur.transitionDur ) {

				const k = ( t - cur.at ) / cur.transitionDur;
				return { camera: cameraOf( cur ), from: cameraOf( prev ), blend: k * k * ( 3 - 2 * k ) };

			}

			return { camera: cameraOf( cur ), from: null, blend: 1 };

		}

		// captureStream(fps) auto-samples on canvas repaint; requestFrame() (where
		// supported) forces an exact capture per composited frame.
		const stream = outCanvas.captureStream( fps );
		const videoTrack = stream.getVideoTracks()[ 0 ];

		// Downstream tools (ffmpeg -map 0:a, etc.) assume every exported video has
		// an audio channel — MediaRecorder's captureStream() has none by default,
		// so `-map 0:a` on the plain video-only output errors out with "Stream
		// map matches no streams". Add a real (silent) audio track: a zero-gain
		// constant source feeding a MediaStreamDestination, so the recorded file
		// always has one — just carrying silence.
		const AudioCtx = window.AudioContext || window.webkitAudioContext;
		const audioCtx = new AudioCtx();
		const audioDest = audioCtx.createMediaStreamDestination();
		const silenceGain = audioCtx.createGain();
		silenceGain.gain.value = 0;
		const silenceSource = audioCtx.createConstantSource();
		silenceSource.connect( silenceGain ).connect( audioDest );
		silenceSource.start();
		for ( const track of audioDest.stream.getAudioTracks() ) stream.addTrack( track );

		// Re-bake any call-card object(s) with a FRESH live fetch of
		// /about/callcard right before recording starts — this is what makes the
		// card "living for future renders": whatever the card says right now is
		// what gets baked into this export, stamped with its current version.
		// Already-rendered mp4s are unaffected (their frames were baked at THEIR
		// render time). Best-effort: a failed fetch just leaves whatever texture
		// the object already had (logged via refreshCallcard's own console.warn).
		const callcards = findCallcards( scene );
		if ( callcards.length ) {

			setProgress( 0, 'Refreshing call card\u2026' );
			await Promise.all( callcards.map( refreshCallcard ) );

		}

		const recorder = new MediaRecorder( stream, {
			mimeType: mime,
			videoBitsPerSecond: Math.min( 24_000_000, width * height * fps * 0.15 ),
		} );
		const chunks = [];
		recorder.ondataavailable = e => { if ( e.data && e.data.size > 0 ) chunks.push( e.data ); };
		const recorderStopped = new Promise( resolve => { recorder.onstop = resolve; } );
		recorder.start();

		const totalFrames = Math.max( 1, Math.round( renderLength * fps ) );
		const frameMs = 1000 / fps;

		try {

			// Wall-clock driven: MediaRecorder timestamps frames by real time, so
			// sampling the timeline at the true elapsed time keeps the output video
			// duration equal to the render length even when the browser throttles
			// timers (background tab) — throttling just drops frames. `elapsed` is
			// OUTPUT video time; content time is offset by `skip` and clamped to
			// `duration` so the tail seconds hold the last frame frozen.
			const startWall = performance.now();

			while ( true ) {

				if ( cancelRequested ) break;

				const elapsed = ( performance.now() - startWall ) / 1000;
				const outT = Math.min( renderLength, elapsed );
				const t = Math.min( duration, skip + outT );

				holdTimelineAt( editor, t );

				// Shot/camera-cut blend time is intentionally NOT clamped to `duration`
				// like `t` above — a shot cut placed right at the timeline's end (e.g.
				// a fade into a trailing call card) would otherwise freeze stuck at the
				// START of its transition (blend 0) for the whole tail, instead of
				// finishing the fade and holding on the fully-resolved final shot.
				const shotT = skip + outT;

				const state = shotStateAt( shotT );

				if ( state.from ) {

					// crossfade: previous shot full, current shot on top with alpha
					if ( is360 ) renderEquirectFace( state.from ); else renderer.render( scene, state.from );
					ctx.globalAlpha = 1;
					ctx.drawImage( glCanvas, 0, 0 );
					if ( is360 ) renderEquirectFace( state.camera ); else renderer.render( scene, state.camera );
					ctx.globalAlpha = state.blend;
					ctx.drawImage( glCanvas, 0, 0 );
					ctx.globalAlpha = 1;

				} else {

					if ( is360 ) renderEquirectFace( state.camera ); else renderer.render( scene, state.camera );
					ctx.drawImage( glCanvas, 0, 0 );

				}

				if ( burnCheckbox.getValue() ) {

					const cue = activeCueAt( getCues(), outT );
					if ( cue && cue.text ) drawBurnedCaption( ctx, width, height, cue.text );

				}

				if ( videoTrack.requestFrame ) videoTrack.requestFrame();

				const tail = t >= duration && outT < renderLength ? ' (holding final frame)' : '';
				setProgress( outT / renderLength, `Rendering ${ outT.toFixed( 2 ) }s / ${ renderLength.toFixed( 2 ) }s (${ Math.round( outT * fps ) } / ${ totalFrames } frames)${ tail }` );

				if ( outT >= renderLength ) break;

				await sleep( frameMs );

			}

		} finally {

			recorder.stop();
			await recorderStopped;

			silenceSource.stop();
			audioCtx.close();

			for ( const restore of cameraRestores ) restore();
			restoreEnvironment();
			holdTimelineAt( editor, 0 );
			signals.sceneGraphChanged.dispatch();
			renderer.dispose();
			if ( is360 ) {

				cubeRenderTarget.dispose();
				equirectMaterial.dispose();
				quadGeometry.dispose();

			}

			rendering = false;
			cancelButton.dom.style.display = 'none';
			hideRenderOverlay();
			updateDuration(); // re-enables the render button if timeline non-empty

		}

		if ( cancelRequested ) {

			setProgress( 0, 'Render cancelled.' );
			previewWrap.style.display = 'none';
			return;

		}

		const blob = new Blob( chunks, { type: mime.split( ';' )[ 0 ] } );
		const label = shots.length > 0 ? 'sequence' : ( fallbackCamera.name || 'camera' ).replace( /[^\w\-]+/g, '_' );
		const baseName = `render-${ is360 ? '360-' : '' }${ label }-${ width }x${ height }-${ fps }fps`;
		downloadBlob( blob, `${ baseName }.${ extensionFor( mime ) }` );

		postRenderActions.innerHTML = '';

		// A second automatic download() right after the first is silently
		// blocked by Chrome/Firefox's multi-download abuse guard (no new user
		// gesture in between) — confirmed empirically, the .srt never reached
		// disk. Surface a real button instead: a genuine click always passes.
		if ( sidecarCheckbox.getValue() && getCues().length > 0 ) {

			const srtLink = new UIButton( '\u2b07 Download matching .srt' );
			srtLink.dom.style.cssText = 'height:22px;padding:0 8px;border-radius:4px;font-size:11px;';
			srtLink.onClick( function () {

				downloadBlob( new Blob( [ cuesToSrt( getCues() ) ], { type: 'text/plain' } ), `${ baseName }.srt` );

			} );
			postRenderActions.appendChild( srtLink.dom );

		}

		setProgress( 1, is360 ? 'Done — 360 video downloaded.' : 'Done — video downloaded.' );

	}

	updateDuration();
	refreshSequencer();

	return container;

}

export { SidebarRender };
