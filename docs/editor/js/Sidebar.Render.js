import * as THREE from 'three';

import { UIPanel, UIDiv, UIRow, UIText, UIButton, UISelect, UINumber, UICheckbox, UITextArea, UIInput } from './libs/ui.js';
import { holdTimelineAt, getImportedClips } from './intelligence/timelineController.js';
import { findCallcards, refreshCallcard } from './Callcard.js';
import { swapNodeMaterials } from './toon/WebGLFallback.js';
import { RENDER_CLEAR_COLOR, LinearOutput, applyRenderSettings, webglEnvironment } from './toon/RenderPipeline.js';
import { createEmptyHint } from './EmptyHint.js';
import { parseSrt, cuesToSrt, activeCueAt, normalizeCues, cuesEqual, newCueId } from './intelligence/subtitles.js';
import { SetSubtitlesCommand } from './commands/SetSubtitlesCommand.js';
import { AddObjectCommand } from './commands/AddObjectCommand.js';
import { renderBaseName, DEFAULT_VIDEO_TEMPLATE, DEFAULT_SNAPSHOT_TEMPLATE } from './intelligence/renderFileName.js';
import { sourceFile } from './workState.js';
import { applyCameraMove, clearCameraMove, MOVE_PRESETS } from './intelligence/cameraMoveEdit.js';
import { Mp4Muxer } from './export/Mp4Muxer.js';
import {
	DETERMINISM_COPY, totalFrames as frameCount, frameTimestampUs, frameDurationUs, resolveRange, frameTimes,
	avcCodecCandidates, targetBitrate, contractLine,
} from './export/frames.js';

// ── hard-burn caption drawing (parse / format / sync helpers live in intelligence/subtitles.js) ──

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
	ctx.shadowColor = '#000';
	ctx.shadowBlur = fontSize * 0.12;
	ctx.shadowOffsetX = fontSize * 0.04;
	ctx.shadowOffsetY = fontSize * 0.06;

	lines.forEach( ( l, i ) => {

		const y = startY + i * lineHeight;
		ctx.strokeText( l, width / 2, y );
		ctx.fillText( l, width / 2, y );

	} );

	ctx.restore();

}

// ── 360° video metadata (Google Spherical Video V1 XML) ────────────────────
// Pixel content alone never tells YouTube/VR players "this is a 360 video" —
// they key off this metadata box. Splicing a "uuid" box in right after the
// leading "ftyp" box works for MP4 (a plain top-level box insertion, no
// existing box sizes need updating). WebM's EBML container would instead need
// the Tracks/TrackEntry element sizes recomputed to insert a Projection
// element, which risks corrupting MediaRecorder's often unknown-size output —
// so WebM exports are left unmodified (re-export as MP4 to get 360 metadata).

const SPHERICAL_XML = '<?xml version="1.0"?>\n<rdf:SphericalVideo\n' +
	'xmlns:rdf=\'http://www.w3.org/1999/02/22-rdf-syntax-ns#\'\n' +
	'xmlns:GSpherical=\'http://ns.google.com/videos/1.0/spherical/\'>\n' +
	'<GSpherical:Spherical>true</GSpherical:Spherical>\n' +
	'<GSpherical:Stitched>true</GSpherical:Stitched>\n' +
	'<GSpherical:StitchingSoftware>Strata</GSpherical:StitchingSoftware>\n' +
	'<GSpherical:ProjectionType>equirectangular</GSpherical:ProjectionType>\n' +
	'</rdf:SphericalVideo>\n';

const SPHERICAL_UUID = [ 0xff, 0xcc, 0x82, 0x63, 0xf8, 0x55, 0x4a, 0x93, 0x88, 0x14, 0x58, 0x7a, 0x02, 0x52, 0x1f, 0xdd ];

/** The spherical-video metadata as one finished `uuid` box (Mp4Muxer places it itself, so its sample offsets stay right). */
function sphericalMetadataBox() {

	const xmlBytes = new TextEncoder().encode( SPHERICAL_XML );
	const boxSize = 8 + SPHERICAL_UUID.length + xmlBytes.length;
	const box = new Uint8Array( boxSize );
	new DataView( box.buffer ).setUint32( 0, boxSize, false );
	box.set( [ 0x75, 0x75, 0x69, 0x64 ], 4 ); // 'uuid'
	box.set( SPHERICAL_UUID, 8 );
	box.set( xmlBytes, 8 + SPHERICAL_UUID.length );
	return box;

}

/** Returns a new Blob with the spherical-video "uuid" box spliced in after "ftyp" — or the original blob unchanged if it isn't a plain MP4 this can patch.
 * Only for fragmented MP4 (MediaRecorder): the offsets inside a fragment are relative, so the shift is harmless. */
async function injectSphericalMetadata( blob ) {

	const buf = new Uint8Array( await blob.arrayBuffer() );
	if ( buf.length < 8 || String.fromCharCode( buf[ 4 ], buf[ 5 ], buf[ 6 ], buf[ 7 ] ) !== 'ftyp' ) return blob;

	const ftypSize = new DataView( buf.buffer ).getUint32( 0, false );
	if ( ftypSize < 8 || ftypSize > buf.length ) return blob;

	const xmlBytes = new TextEncoder().encode( SPHERICAL_XML );
	const boxSize = 8 + SPHERICAL_UUID.length + xmlBytes.length;

	const box = new Uint8Array( boxSize );
	new DataView( box.buffer ).setUint32( 0, boxSize, false );
	box.set( [ 0x75, 0x75, 0x69, 0x64 ], 4 ); // 'uuid'
	box.set( SPHERICAL_UUID, 8 );
	box.set( xmlBytes, 8 + SPHERICAL_UUID.length );

	const out = new Uint8Array( buf.length + boxSize );
	out.set( buf.subarray( 0, ftypSize ), 0 );
	out.set( box, ftypSize );
	out.set( buf.subarray( ftypSize ), ftypSize + boxSize );

	return new Blob( [ out ], { type: blob.type } );

}

// ── Sidebar.Render.js ─────────────────────────────────────────────────────────
// The "Render" tab: renders the Universal Timeline to a video file through a
// chosen camera. Uses a dedicated offscreen WebGLRenderer (so the viewport is
// untouched), steps the ONE shared clock frame-by-frame via holdTimelineAt(),
// and has two modes that name their guarantee (export/frames.js DETERMINISM_COPY):
//   Render (offline)    every frame n is drawn at timeline time n / fps, fenced, and handed to a WebCodecs
//                       VideoEncoder with PTS n * 1e6 / fps; export/Mp4Muxer.js writes it as exact constant-frame-rate
//                       MP4. No wall clock decides anything. Frame ranges are supported.
//   Preview (realtime)  canvas.captureStream() + MediaRecorder, paced to the wall clock (MediaRecorder timestamps
//                       frames by real time). May drop frames; not reproducible.

// A button with a Font Awesome icon before its label (no emoji: the app's icons are Font Awesome).
function iconButton( icon, label ) {

	const b = new UIButton();
	b.dom.innerHTML = `<i class="fa-solid fa-${ icon } btn-icon" aria-hidden="true"></i>`;
	if ( label ) b.dom.appendChild( document.createTextNode( label ) );
	return b;

}

function SidebarRender( editor ) {

	const signals = editor.signals;

	const container = new UIPanel();
	// NOT 'render' — the sidebar tab span itself gets id 'render' (same collision
	// rule as the Shell tab: tab id must differ from the panel's own id).
	container.setId( 'render-panel' );

	// ── Sub-tabs: one thing at a time ─────────────────────────────────────────
	// Snapshot (a still), Video (the timeline to a video file), 360° (the same as an equirectangular video) and Subtitles
	// (the cue list and the .srt). The progress bar, status, Cancel and preview sit below the panes and stay in view from any tab.

	const SUBTABS = [ [ 'snapshot', 'Snapshot', 'camera' ], [ 'video', 'Video', 'video' ], [ 'pano', '360\u00b0', 'globe' ], [ 'subtitles', 'Subtitles', 'closed-captioning' ] ];
	const SUBTAB_KEY = 'strata.render.tab';

	// Same markup as the sidebar's own tabs (.Tabs > .Tab > .tab-icon + .tab-label, styled by the .TabbedPanel rules): an icon with its label below.
	const tabBar = document.createElement( 'div' );
	tabBar.className = 'Tabs render-subtabs';
	tabBar.setAttribute( 'role', 'tablist' );
	container.dom.appendChild( tabBar );

	const panes = {}, tabButtons = {};
	for ( const [ id, label, icon ] of SUBTABS ) {

		const b = document.createElement( 'span' );
		b.className = 'Tab';
		b.innerHTML = `<span class="tab-icon"><i class="fa-solid fa-${ icon }" aria-hidden="true"></i></span><span class="tab-label">${ label }</span>`;
		b.setAttribute( 'role', 'tab' );
		b.tabIndex = 0;
		b.addEventListener( 'click', () => selectRenderTab( id ) );
		b.addEventListener( 'keydown', event => { if ( event.key === 'Enter' || event.key === ' ' ) { event.preventDefault(); selectRenderTab( id ); } } );
		tabBar.appendChild( b );
		tabButtons[ id ] = b;

		const pane = new UIDiv();
		pane.dom.className = 'render-subpane';
		pane.dom.setAttribute( 'role', 'tabpanel' );
		container.add( pane );
		panes[ id ] = pane;

	}

	const snapshotPane = panes.snapshot, videoPane = panes.video, panoPane = panes.pano, subtitlesPane = panes.subtitles;

	function selectRenderTab( id ) {

		if ( ! panes[ id ] ) id = 'video';
		currentTab = id;
		for ( const [ key ] of SUBTABS ) {

			const on = key === id;
			panes[ key ].dom.style.display = on ? '' : 'none';
			tabButtons[ key ].classList.toggle( 'selected', on );
			tabButtons[ key ].setAttribute( 'aria-selected', on ? 'true' : 'false' );

		}

		try { localStorage.setItem( SUBTAB_KEY, id ); } catch ( e ) { /* storage blocked */ }
		refreshOutputVisibility();

	}

	// ── Snapshot (still image of the current scene state) ─────────────────────

	const snapHelp = new UIText( 'Saves a still image of the scene as it is right now (no timeline playback), rendered offscreen without the editor grid or gizmos.' );
	snapHelp.dom.style.cssText = 'display:block;font-size:11px;opacity:0.7;margin:0 0 10px;line-height:1.4;';
	snapshotPane.add( snapHelp );

	const snapCameraRow = new UIRow();
	snapCameraRow.add( new UIText( 'Camera' ).setClass( 'Label' ) );
	const snapCameraSelect = new UISelect().setWidth( '160px' );
	snapCameraRow.add( snapCameraSelect );
	snapshotPane.add( snapCameraRow );

	const snapSizeRow = new UIRow();
	snapSizeRow.add( new UIText( 'Size' ).setClass( 'Label' ) );
	const snapSizeSelect = new UISelect().setWidth( '160px' );
	snapSizeSelect.setOptions( {
		'viewport': 'Viewport size',
		'viewport2x': 'Viewport \u00d7 2',
		'1280x720': '1280 \u00d7 720 (720p)',
		'1920x1080': '1920 \u00d7 1080 (1080p)',
		'3840x2160': '3840 \u00d7 2160 (4K)',
		'1080x1080': '1080 \u00d7 1080 (square)',
	} );
	snapSizeSelect.setValue( 'viewport2x' );
	snapSizeRow.add( snapSizeSelect );
	snapshotPane.add( snapSizeRow );

	const snapFormatRow = new UIRow();
	snapFormatRow.add( new UIText( 'Format' ).setClass( 'Label' ) );
	const snapFormatSelect = new UISelect().setWidth( '160px' );
	snapFormatSelect.setOptions( { 'png': 'PNG', 'jpeg': 'JPEG', 'webp': 'WebP' } );
	snapFormatSelect.setValue( 'png' );
	snapFormatRow.add( snapFormatSelect );
	snapshotPane.add( snapFormatRow );

	const snapTransparentRow = new UIRow();
	snapTransparentRow.add( new UIText( 'Transparent' ).setClass( 'Label' ) );
	const snapTransparentCheckbox = new UICheckbox( false );
	snapTransparentRow.add( snapTransparentCheckbox );
	snapTransparentRow.add( new UIText( 'background (PNG / WebP)' ).setMarginLeft( '6px' ) );
	snapshotPane.add( snapTransparentRow );

	const snapButtonRow = new UIRow();
	const snapshotButton = iconButton( 'camera', 'Take Snapshot' );
	snapshotButton.dom.style.cssText = 'padding:6px 14px;border-radius:4px;font-weight:bold;';
	snapshotButton.onClick( function () { takeSnapshot(); } );
	snapButtonRow.add( snapshotButton );
	snapshotPane.add( snapButtonRow );

	function refreshSnapshotCameras() {

		const options = { 'viewport': 'Current view' };
		for ( const uuid in editor.cameras ) {

			if ( uuid === editor.camera.uuid ) continue;
			options[ uuid ] = editor.cameras[ uuid ].name || 'Camera';

		}

		const previous = snapCameraSelect.getValue();
		snapCameraSelect.setOptions( options );
		snapCameraSelect.setValue( options[ previous ] ? previous : 'viewport' );

	}

	refreshSnapshotCameras();
	signals.sceneGraphChanged.add( refreshSnapshotCameras );
	signals.viewportCameraChanged.add( refreshSnapshotCameras );

	// ── Header ────────────────────────────────────────────────────────────────

	const help = new UIText( 'Renders the Universal Timeline to a video. Use the camera sequence below to cut/fade between cameras over time; with no shots, Edit Camera (the viewport nav camera) is used throughout.' );
	help.dom.style.cssText = 'display:block;font-size:11px;opacity:0.7;margin:0 0 10px;line-height:1.4;';
	videoPane.add( help );

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
	videoPane.add( resolutionRow );

	// The viewport's "Match render" frame guide (ViewLook.js) reads the flat render size from here.
	editor.renderOutput = {
		getSize() {

			const [ width, height ] = resolutionSelect.getValue().split( 'x' ).map( Number );
			return { width, height };

		}
	};
	resolutionSelect.dom.addEventListener( 'change', function () { window.dispatchEvent( new CustomEvent( 'strata:render-output-changed' ) ); } );

	// ── The settings of one kind of render ────────────────────────────────────
	// Video and 360° each get a full, independent set (FPS, mode, encoder, frame range, file name, Skip First, duration, subtitle options),
	// built by createSettings() into their own tab. What is shared is scene data, not a setting: the Camera Sequence and the subtitle cues.

	// Extra time recorded after the timeline's last frame, holding it frozen —
	// gives viewers a beat to register the final state instead of the video
	// cutting off the instant the last animation ends.
	const RENDER_TAIL_SECONDS = 2;

	// What the last offline render cost per frame on this machine, so the next estimate can say so
	const MS_PER_FRAME_KEY = 'strata.render.msPerFrame';
	const readMsPerFrame = () => { try { return parseFloat( localStorage.getItem( MS_PER_FRAME_KEY ) ) || 0; } catch ( e ) { return 0; } };

	function timelineDuration() {

		const anims = editor.scene.animations || [];
		const clip = anims.find( c => c.userData && c.userData.isTimeline );
		const authored = clip && clip.duration > 0 ? clip.duration : ( editor.timeline ? editor.timeline.duration : 0 );

		// Imported glTF clips ride the same clock (see Timeline.js totalDuration).
		return Math.max( authored, ...getImportedClips( editor ).map( c => c.duration ) );

	}

	// What the downloaded file is called: the loaded scene's file name, then a readable summary of the render.
	function projectForNames() {

		const status = editor.work && editor.work.status ? editor.work.status() : null;
		const file = status ? sourceFile( status.key ) : '';
		if ( file ) return file;
		const sceneName = editor.scene.name;
		return sceneName && sceneName !== 'Scene' ? sceneName : '';

	}

	const allSettings = [];

	function createSettings( pane, kind, resolutionSelect ) {

		const is360 = kind === '360';
		const S = { kind, is360, resolutionSelect };
		allSettings.push( S );

		// FPS
		const fpsRow = new UIRow();
		fpsRow.add( new UIText( 'FPS' ).setClass( 'Label' ) );
		S.fpsSelect = new UISelect().setWidth( '160px' );
		S.fpsSelect.setOptions( { '24': '24', '30': '30', '60': '60' } );
		S.fpsSelect.setValue( '30' );
		fpsRow.add( S.fpsSelect );
		pane.add( fpsRow );

		// Mode: name the guarantee, not a quality level
		const modeRow = new UIRow();
		modeRow.add( new UIText( 'Mode' ).setClass( 'Label' ) );
		S.modeSelect = new UISelect().setWidth( '160px' );
		S.modeSelect.setOptions( { offline: 'Render (offline)', preview: 'Preview (realtime)' } );
		S.modeSelect.setValue( 'offline' );
		modeRow.add( S.modeSelect );
		pane.add( modeRow );

		const modeHelp = new UIText( '' );
		modeHelp.dom.style.cssText = 'display:block;font-size:11px;opacity:0.7;margin:-4px 0 8px;line-height:1.4;';
		pane.add( modeHelp );

		const encoderRow = new UIRow();
		encoderRow.add( new UIText( 'Encoder' ).setClass( 'Label' ) );
		S.encoderSelect = new UISelect().setWidth( '160px' );
		S.encoderSelect.setOptions( { hardware: 'Hardware if available (fast)', software: 'Software (byte-identical files)' } );
		S.encoderSelect.setValue( 'hardware' );
		S.encoderSelect.dom.title = 'The frames are identical either way. A hardware H.264 encoder may write different bytes for the same frames on a repeat render; the software encoder writes the same bytes every time, and is slower.';
		encoderRow.add( S.encoderSelect );
		pane.add( encoderRow );

		// Frame range (offline only): inclusive, 0-based. Blank = the first / the last frame. A range render is
		// splice-safe: frame n is the same picture whether it is rendered alone or inside a full render.
		const rangeRow = new UIRow();
		rangeRow.add( new UIText( 'Frames' ).setClass( 'Label' ) );
		S.rangeStart = new UIInput( '' ).setWidth( '70px' ); // UIInput( undefined ) would show the text "undefined"
		S.rangeStart.dom.placeholder = 'first';
		S.rangeEnd = new UIInput( '' ).setWidth( '70px' );
		S.rangeEnd.dom.placeholder = 'last';
		S.rangeEnd.dom.style.marginLeft = '6px';
		rangeRow.add( S.rangeStart );
		rangeRow.add( S.rangeEnd );
		pane.add( rangeRow );

		const contractText = new UIText( '' );
		contractText.dom.style.cssText = 'display:block;font-size:11px;opacity:0.85;margin:-4px 0 8px 90px;';
		pane.add( contractText );

		const determinismHelp = new UIText( [ DETERMINISM_COPY.temporal, DETERMINISM_COPY.sameDevice, DETERMINISM_COPY.crossDevice ].join( ' ' ) );
		determinismHelp.dom.style.cssText = 'display:block;font-size:11px;opacity:0.6;margin:0 0 10px;line-height:1.4;';
		pane.add( determinismHelp );

		// File name (a template; blank = the default)
		const nameRow = new UIRow();
		nameRow.add( new UIText( 'File name' ).setClass( 'Label' ) );
		S.nameInput = new UIInput().setWidth( '160px' );
		S.nameInput.dom.placeholder = DEFAULT_VIDEO_TEMPLATE;
		S.nameInput.dom.title = 'Tokens: {project} {duration} {res} {fps} {date} {time} {camera} {360}. Leave blank for the default.';
		const nameKey = is360 ? 'strata.render.fileName360' : 'strata.render.fileName';
		try { S.nameInput.setValue( localStorage.getItem( nameKey ) || '' ); } catch ( e ) { /* storage blocked */ }
		nameRow.add( S.nameInput );
		pane.add( nameRow );

		const namePreview = new UIText( '' );
		namePreview.dom.style.cssText = 'display:block;font-size:11px;opacity:0.7;margin:-4px 0 8px 90px;word-break:break-all;';
		pane.add( namePreview );

		// Skip First (trims the render's in-point, e.g. to cut a static lead-in)
		const skipRow = new UIRow();
		skipRow.add( new UIText( 'Skip First' ).setClass( 'Label' ) );
		S.skipSelect = new UISelect().setWidth( '160px' );
		S.skipSelect.setOptions( { '0': 'None', '1': '1 s', '2': '2 s', '3': '3 s', '4': '4 s', '5': '5 s' } );
		S.skipSelect.setValue( '0' );
		skipRow.add( S.skipSelect );
		pane.add( skipRow );

		// Duration (from the universal timeline: read-only)
		const durationRow = new UIRow();
		durationRow.add( new UIText( 'Duration' ).setClass( 'Label' ) );
		const durationText = new UIText( '0.00 s' );
		durationRow.add( durationText );
		pane.add( durationRow );

		// Subtitle options: the controls exist now, and the tab adds them where they belong in its layout
		S.burnCheckbox = new UICheckbox( false );
		S.sidecarCheckbox = new UICheckbox( true );
		S.addSubtitleOptions = function () {

			const burnRow = new UIRow();
			burnRow.add( S.burnCheckbox );
			burnRow.add( new UIText( ' Hard-burn subtitles into video' ).setFontSize( '11px' ) );
			pane.add( burnRow );

			const sidecarRow = new UIRow();
			sidecarRow.add( S.sidecarCheckbox );
			sidecarRow.add( new UIText( ' Also export a matching .srt file' ).setFontSize( '11px' ) );
			pane.add( sidecarRow );

		};

		S.skipSeconds = duration => Math.min( parseFloat( S.skipSelect.getValue() ) || 0, duration );
		S.outputDuration = duration => Math.max( 0, duration - S.skipSeconds( duration ) ) + RENDER_TAIL_SECONDS;

		S.videoBaseName = ( { width, height, fps, duration } ) =>
			renderBaseName( { template: S.nameInput.getValue().trim() || DEFAULT_VIDEO_TEMPLATE, project: projectForNames(), width, height, fps, duration, is360 } );

		S.refreshContract = function () {

			const d = timelineDuration();
			if ( S.modeSelect.getValue() !== 'offline' || ! ( d > 0 ) ) { contractText.setValue( '' ); return; }
			const fps = parseInt( S.fpsSelect.getValue(), 10 );
			const total = frameCount( S.outputDuration( d ), fps );
			const range = resolveRange( S.rangeStart.getValue().trim(), S.rangeEnd.getValue().trim(), total );
			contractText.setValue( range.error ? range.error : contractLine( range.count, fps, readMsPerFrame() ) );

		};

		S.refreshMode = function () {

			const offline = S.modeSelect.getValue() === 'offline';
			modeHelp.setValue( offline ? DETERMINISM_COPY.offline : DETERMINISM_COPY.preview );
			rangeRow.dom.style.display = offline ? '' : 'none';
			encoderRow.dom.style.display = offline ? '' : 'none';
			determinismHelp.dom.style.display = offline ? '' : 'none';
			S.refreshContract();

		};

		S.refreshNamePreview = function () {

			const [ width, height ] = S.resolutionSelect.getValue().split( 'x' ).map( Number );
			const d = timelineDuration();
			namePreview.setValue( '\u2192 ' + S.videoBaseName( { width, height, fps: parseInt( S.fpsSelect.getValue(), 10 ), duration: d > 0 ? S.outputDuration( d ) : 0 } ) + '.mp4' );

		};

		S.refreshDuration = function () {

			const d = timelineDuration();
			durationText.setValue( d > 0 ? `${ d.toFixed( 2 ) } s (renders ${ S.outputDuration( d ).toFixed( 2 ) } s)` : 'Timeline is empty' );
			S.refreshNamePreview();
			S.refreshContract();

		};

		S.modeSelect.dom.addEventListener( 'change', S.refreshMode );
		S.fpsSelect.dom.addEventListener( 'change', S.refreshContract );
		S.fpsSelect.dom.addEventListener( 'change', S.refreshNamePreview );
		S.rangeStart.dom.addEventListener( 'input', S.refreshContract );
		S.rangeEnd.dom.addEventListener( 'input', S.refreshContract );
		S.skipSelect.onChange( S.refreshDuration );
		resolutionSelect.dom.addEventListener( 'change', S.refreshNamePreview );
		S.nameInput.dom.addEventListener( 'input', function () {

			try { localStorage.setItem( nameKey, S.nameInput.getValue() ); } catch ( e ) { /* storage blocked */ }
			S.refreshNamePreview();

		} );
		// The scene's file name is only known once a load finishes, so also refresh when the scene changes or the panel is used.
		signals.sceneGraphChanged.add( S.refreshNamePreview );
		container.dom.addEventListener( 'pointerenter', S.refreshNamePreview );

		return S;

	}

	const flat = createSettings( videoPane, 'flat', resolutionSelect );

	function updateDuration() {

		const d = timelineDuration();
		renderButton.dom.disabled = ( d <= 0 ) || rendering;
		equirectButton.dom.disabled = ( d <= 0 ) || rendering;
		for ( const S of allSettings ) S.refreshDuration();

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
	videoPane.add( seqHeader );

	const seqLane = document.createElement( 'div' );
	seqLane.style.cssText = 'position:relative;height:34px;border:1px solid rgba(128,128,128,0.4);border-radius:4px;background:rgba(128,128,128,0.12);margin:4px 0 6px;overflow:hidden;';
	videoPane.dom.appendChild( seqLane );

	const seqControls = document.createElement( 'div' );
	seqControls.style.cssText = 'margin-bottom:8px;';
	videoPane.dom.appendChild( seqControls );

	const addShotButton = new UIButton( '+ Add Shot' );
	addShotButton.dom.style.cssText = 'height:22px;padding:0 8px;border-radius:4px;font-size:11px;';
	addShotButton.onClick( () => addShot() );
	seqControls.appendChild( addShotButton.dom );

	// A new scene camera from where the Edit Camera is now, cut in as the next shot.
	const addCameraButton = new UIButton( '+ Camera from view' );
	addCameraButton.dom.style.cssText = 'height:22px;padding:0 8px;border-radius:4px;font-size:11px;margin-left:6px;';
	addCameraButton.dom.title = 'Add a scene camera at the Edit Camera\'s current view and cut to it as the next shot';
	addCameraButton.onClick( addCameraFromView );
	seqControls.appendChild( addCameraButton.dom );

	// First-run hint while there are no shots (hidden once one exists or when dismissed)
	const shotsHint = createEmptyHint( {
		id: 'render-shots',
		title: 'No shots yet',
		text: 'A shot is a camera that takes over at a time on the timeline; add two to cut or fade between them. Until then the render uses the Edit Camera. Add a camera first, then + Add Shot. In the Shell tab:',
		examples: [ { label: 'camera', code: 'editor.execute( new AddObjectCommand( editor, new THREE.PerspectiveCamera() ) )' } ]
	} );
	seqControls.appendChild( shotsHint.dom );

	const shotDetail = document.createElement( 'div' );
	shotDetail.style.cssText = 'margin-top:6px;display:none;';
	seqControls.appendChild( shotDetail );

	let selectedShotId = null;
	let lastMoveKind = 'push';

	function getShots() {

		const ud = editor.scene.userData = editor.scene.userData || {};
		if ( ! Array.isArray( ud.renderShots ) ) ud.renderShots = [];
		ud.renderShots.sort( ( a, b ) => a.at - b.at );
		return ud.renderShots;

	}

	function cameraOf( shot ) {

		return ( shot && editor.cameras[ shot.camera ] ) || editor.camera;

	}

	function addShot( forcedCamera ) {

		const shots = getShots();
		const dur = Math.max( timelineDuration(), 1 );
		const lastAt = shots.length ? shots[ shots.length - 1 ].at : - 1;
		const at = shots.length === 0 ? 0 : Math.min( dur - 0.1, lastAt + Math.max( 0.5, ( dur - lastAt ) / 2 ) );
		// Edit Camera (editor.camera) IS in editor.cameras (it's also the
		// viewport's own camera switcher's default entry), but it's never a
		// valid shot camera here — default to whichever scene camera exists
		// first instead.
		const sceneCameras = Object.keys( editor.cameras ).filter( uuid => uuid !== editor.camera.uuid );
		const lastCam = shots.length ? sceneCameras.indexOf( shots[ shots.length - 1 ].camera ) : - 1;
		const firstSceneCamera = sceneCameras[ ( lastCam + 1 ) % Math.max( 1, sceneCameras.length ) ] || editor.camera.uuid;
		const shot = {
			id: 'shot-' + Math.random().toString( 36 ).slice( 2, 9 ),
			at: Math.max( 0, at ),
			camera: forcedCamera || firstSceneCamera,
			transition: shots.length === 0 ? 'cut' : 'fade',
			transitionDur: 0.5,
		};
		shots.push( shot );
		selectedShotId = shot.id;
		refreshSequencer();

	}

	function addCameraFromView() {

		const edit = editor.camera;
		const sceneCameras = Object.keys( editor.cameras ).filter( uuid => uuid !== edit.uuid );
		const cam = new THREE.PerspectiveCamera( edit.fov, 16 / 9, 0.1, 2000 );
		cam.name = 'Shot ' + ( sceneCameras.length + 1 );
		cam.position.copy( edit.position );
		const aim = editor.controls && editor.controls.center ? editor.controls.center : edit.getWorldDirection( new THREE.Vector3() ).add( edit.position );
		cam.lookAt( aim );
		editor.execute( new AddObjectCommand( editor, cam ) );
		addShot( cam.uuid );

	}

	function refreshSequencer() {

		const shots = getShots();
		const dur = Math.max( timelineDuration(), 0.001 );
		seqLane.innerHTML = '';
		shotsHint.setEmpty( shots.length === 0 );

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

		// camera picker — editor.camera ("Edit Camera") is registered in
		// editor.cameras too (for the viewport's OWN camera switcher), but it's
		// never a valid shot camera here.
		const camSel = new UISelect().setWidth( '110px' );
		const camOptions = {};
		for ( const uuid in editor.cameras ) {

			if ( uuid === editor.camera.uuid ) continue;
			camOptions[ uuid ] = editor.cameras[ uuid ].name || 'Camera';

		}
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

		// camera move: a preset path over this shot's span (see intelligence/cameraPresets.js)
		const moveRow = document.createElement( 'div' );
		moveRow.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:11px;margin-top:5px;';
		shotDetail.appendChild( moveRow );

		const moveLabel = document.createElement( 'span' );
		moveLabel.textContent = 'Move';
		moveRow.appendChild( moveLabel );

		const moveSel = new UISelect().setWidth( '110px' );
		const moveOptions = {};
		for ( const k in MOVE_PRESETS ) moveOptions[ k ] = MOVE_PRESETS[ k ].label;
		moveSel.setOptions( moveOptions );
		moveSel.setValue( lastMoveKind );
		moveRow.appendChild( moveSel.dom );

		const amountNum = new UINumber( MOVE_PRESETS[ lastMoveKind ].amount ).setWidth( '44px' ).setPrecision( 3 );
		const syncAmount = () => {

			const p = MOVE_PRESETS[ moveSel.getValue() ];
			amountNum.setRange( p.min, p.max );
			amountNum.setValue( p.amount );
			amountNum.dom.title = 'Amount, in ' + p.unit;

		};
		moveSel.onChange( function () { lastMoveKind = this.getValue(); syncAmount(); } );
		syncAmount();
		moveRow.appendChild( amountNum.dom );

		const moveStatus = document.createElement( 'span' );
		moveStatus.style.cssText = 'opacity:0.65;font-size:10px;';

		const applyBtn = new UIButton( 'Apply' );
		applyBtn.dom.style.cssText = 'height:20px;padding:0 8px;border-radius:4px;font-size:10px;';
		applyBtn.dom.title = 'Give this shot\'s camera the move, from the start of the shot to the next shot (or the end)';
		applyBtn.onClick( function () {

			const cam = editor.cameras[ shot.camera ];
			if ( ! cam ) return;
			const end = index + 1 < shots.length ? shots[ index + 1 ].at : timelineDuration();

			try {

				applyCameraMove( editor, cam, moveSel.getValue(), { start: shot.at, end, amount: amountNum.getValue() } );
				moveStatus.textContent = MOVE_PRESETS[ moveSel.getValue() ].label + ' · ' + shot.at.toFixed( 1 ) + '–' + end.toFixed( 1 ) + 's';

			} catch ( err ) {

				moveStatus.textContent = err.message;

			}

		} );
		moveRow.appendChild( applyBtn.dom );

		const clearBtn = new UIButton( 'Clear' );
		clearBtn.dom.style.cssText = 'height:20px;padding:0 8px;border-radius:4px;font-size:10px;';
		clearBtn.dom.title = 'Remove this camera\'s move keys (a rotation turn or other events stay)';
		clearBtn.onClick( function () {

			const cam = editor.cameras[ shot.camera ];
			if ( ! cam ) return;
			clearCameraMove( editor, cam );
			moveStatus.textContent = 'Move cleared';

		} );
		moveRow.appendChild( clearBtn.dom );
		moveRow.appendChild( moveStatus );

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

	const subsHelp = new UIText( 'Cue times are OUTPUT video seconds. Hard-burn and the .srt sidecar are switched on in the Video tab; the .srt is for embedding downstream (e.g. via ffmpeg).' );
	subsHelp.dom.style.cssText = 'display:block;font-size:10px;opacity:0.65;margin:0 0 6px;line-height:1.35;';
	subtitlesPane.add( subsHelp );

	const subsList = document.createElement( 'div' );
	subsList.style.cssText = 'display:flex;flex-direction:column;gap:4px;max-height:200px;overflow-y:auto;margin-bottom:6px;';
	subtitlesPane.dom.appendChild( subsList );

	// The scene JSON is the single source of truth: this list only ever READS
	// the cues from scene.userData.renderSubtitles and WRITES through
	// SetSubtitlesCommand (undoable, autosaved, versioned with the scene). It
	// re-reads whenever the cues change from anywhere else (undo/redo, loading a
	// scene, the JS shell), so the list and the scene JSON never drift apart.
	function getCues() {

		return normalizeCues( editor.scene.userData && editor.scene.userData.renderSubtitles );

	}

	function commitCues( next, label ) {

		if ( cuesEqual( getCues(), next ) ) return;
		editor.execute( new SetSubtitlesCommand( editor, next, label ) );

	}

	let shown = []; // the cues the list currently displays (so our own edits don't rebuild the list under the cursor)
	const sameShown = ( a, b ) => a.length === b.length && a.every( ( c, i ) => c.id === b[ i ].id && c.start === b[ i ].start && c.end === b[ i ].end && c.text === b[ i ].text );

	const subsStatus = document.createElement( 'div' );
	subsStatus.style.cssText = 'font-size:10px;opacity:0.65;margin:0 0 6px;';

	function refreshSubsList() {

		const cues = getCues();
		shown = cues.map( c => ( { ...c } ) );
		subsList.innerHTML = '';
		subsStatus.textContent = cues.length === 0 ? '' : `${ cues.length } cue${ cues.length === 1 ? '' : 's' } \u00b7 saved with the scene (scene.userData.renderSubtitles)`;

		if ( cues.length === 0 ) {

			const empty = document.createElement( 'div' );
			empty.style.cssText = 'font-size:10px;opacity:0.55;padding:2px 0 4px;';
			empty.textContent = 'No cues yet — Add Cue or Import .srt.';
			subsList.appendChild( empty );

		}

		cues.forEach( ( cue, i ) => {

			const edit = ( field, value, label ) => { shown[ i ][ field ] = value; commitCues( shown.map( c => ( { ...c } ) ), label ); };

			const row = document.createElement( 'div' );
			row.style.cssText = 'display:flex;align-items:flex-start;gap:4px;';
			subsList.appendChild( row );

			const startNum = new UINumber( cue.start ).setWidth( '46px' ).setPrecision( 2 ).setRange( 0, 100000 );
			startNum.dom.title = 'Start (s)';
			startNum.onChange( function () { edit( 'start', startNum.getValue(), 'Retime subtitle cue' ); } );
			row.appendChild( startNum.dom );

			const arrow = document.createElement( 'span' );
			arrow.textContent = '\u2192';
			arrow.style.cssText = 'font-size:10px;opacity:0.6;padding-top:4px;';
			row.appendChild( arrow );

			const endNum = new UINumber( cue.end ).setWidth( '46px' ).setPrecision( 2 ).setRange( 0, 100000 );
			endNum.dom.title = 'End (s)';
			endNum.onChange( function () { edit( 'end', endNum.getValue(), 'Retime subtitle cue' ); } );
			row.appendChild( endNum.dom );

			const textArea = new UITextArea().setValue( cue.text );
			textArea.dom.rows = 1;
			textArea.dom.style.cssText += 'flex:1;font-size:11px;resize:vertical;min-height:20px;';
			textArea.onChange( function () { edit( 'text', textArea.getValue(), 'Edit subtitle text' ); } );
			row.appendChild( textArea.dom );

			const delBtn = iconButton( 'xmark' );
			delBtn.dom.title = 'Delete this cue';
			delBtn.dom.style.cssText = 'height:20px;width:20px;padding:0;border-radius:4px;font-size:10px;flex-shrink:0;';
			delBtn.onClick( function () { commitCues( shown.filter( ( c, k ) => k !== i ), 'Delete subtitle cue' ); } );
			row.appendChild( delBtn.dom );

		} );

	}

	// scene JSON -> list: refresh only when what the scene holds differs from what the list shows
	function syncSubsFromScene() {

		if ( ! sameShown( getCues(), shown ) ) refreshSubsList();

	}

	signals.subtitlesChanged.add( syncSubsFromScene );
	signals.sceneGraphChanged.add( syncSubsFromScene ); // scene loaded / replaced
	signals.historyChanged.add( syncSubsFromScene );    // undo / redo
	signals.editorCleared.add( syncSubsFromScene );

	const subsControls = document.createElement( 'div' );
	subsControls.style.cssText = 'display:flex;gap:6px;margin-bottom:6px;flex-wrap:wrap;';
	subtitlesPane.dom.appendChild( subsControls );
	subtitlesPane.dom.appendChild( subsStatus );

	const addCueButton = new UIButton( '+ Add Cue' );
	addCueButton.dom.style.cssText = 'height:22px;padding:0 8px;border-radius:4px;font-size:11px;';
	addCueButton.onClick( function () {

		const cues = getCues();
		const lastEnd = cues.length ? Math.max( ...cues.map( c => c.end ) ) : 0;
		commitCues( [ ...cues, { id: newCueId(), start: lastEnd, end: lastEnd + 3, text: '' } ], 'Add subtitle cue' );

	} );
	subsControls.appendChild( addCueButton.dom );

	const importSrtInput = document.createElement( 'input' );
	importSrtInput.type = 'file';
	importSrtInput.accept = '.srt';
	importSrtInput.style.display = 'none';
	subtitlesPane.dom.appendChild( importSrtInput );
	importSrtInput.addEventListener( 'change', function () {

		const file = importSrtInput.files[ 0 ];
		if ( ! file ) return;
		const reader = new FileReader();
		reader.onload = function () {

			const cues = parseSrt( String( reader.result ) );
			if ( cues.length === 0 ) { subsStatus.textContent = 'No cues found in that file — nothing was changed.'; return; }
			// replaces the scene's cues in one undoable, autosaved step; the list follows via subtitlesChanged
			commitCues( cues, `Import subtitles (${ cues.length } cues)` );
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

		downloadBlob( new Blob( [ cuesToSrt( getCues() ) ], { type: 'text/plain' } ), `${ renderBaseName( { template: '{project}_subtitles', project: projectForNames(), width: 0, height: 0 } ) }.srt` );

	} );
	subsControls.appendChild( exportSrtButton.dom );

	flat.addSubtitleOptions();

	// the Render button closes the Video tab's options
	const buttonRow = new UIRow();
	const renderButton = new UIButton( 'Render & Export' );
	renderButton.dom.style.cssText = 'padding:6px 14px;border-radius:4px;font-weight:bold;';
	renderButton.onClick( function () { startRender( 'flat' ); } );
	buttonRow.add( renderButton );
	videoPane.add( buttonRow );

	refreshSubsList();

	// ── 360 (equirectangular) video ────────────────────────────────────────────
	// Its own settings, all in this tab: the 360 resolution (must be 2:1 for a standard equirect video) and a full set of the others.
	// Only scene data is shared with the Video tab: the Camera Sequence, whose cameras contribute POSITION only (orientation and FOV are
	// meaningless for a 360 video, the viewer looks in every direction, so no camera-aspect pinning happens), and the subtitle cues.

	const equirectHelp = new UIText( 'Renders a 360\u00b0 equirectangular video from the Camera Sequence\u2019s cameras\u2019 POSITION at each moment — pan the camera through the scene (or cut/fade between shot positions) to move the 360 viewpoint over time. Records MP4 (360\u00b0 metadata embedded, for YouTube/VR players) and WebM in parallel when the browser supports both — MP4 downloads automatically, WebM is offered as an extra download below. Render (offline) writes the MP4 only.' );
	equirectHelp.dom.style.cssText = 'display:block;font-size:11px;opacity:0.7;margin:0 0 10px;line-height:1.4;';
	panoPane.add( equirectHelp );

	const equirectRow = new UIRow();
	equirectRow.add( new UIText( 'Resolution' ).setClass( 'Label' ) );
	const equirectResolutionSelect = new UISelect().setWidth( '160px' );
	equirectResolutionSelect.setOptions( {
		'3840x1920': '3840 × 1920 (2:1)',
		'2560x1280': '2560 × 1280 (2:1)',
		'1920x960': '1920 × 960 (2:1)',
		'1280x640': '1280 × 640 (2:1)',
	} );
	equirectResolutionSelect.setValue( '1920x960' );
	equirectRow.add( equirectResolutionSelect );
	panoPane.add( equirectRow );

	const pano = createSettings( panoPane, '360', equirectResolutionSelect );

	const panoShared = new UIText( 'The cameras come from the Camera Sequence, and the cues from Subtitles; both are scene data you edit in their own tabs.' );
	panoShared.dom.style.cssText = 'display:block;font-size:11px;opacity:0.7;margin:4px 0 6px;line-height:1.4;';
	panoPane.add( panoShared );

	pano.addSubtitleOptions();

	const panoButtonRow = new UIRow();
	const equirectButton = new UIButton( 'Render 360 Video' );
	equirectButton.dom.style.cssText = 'padding:6px 14px;border-radius:4px;font-weight:bold;';
	equirectButton.onClick( function () { startRender( '360' ); } );
	panoButtonRow.add( equirectButton );
	panoPane.add( panoButtonRow );

	// ── Render / Cancel buttons ───────────────────────────────────────────────

	// The output area (Cancel, progress, status, result, preview) sits below the tabs. It belongs to the tab that produced it, and shows
	// there; a running render shows on every tab, so it can be watched and cancelled from wherever you are.
	const outputArea = document.createElement( 'div' );
	container.dom.appendChild( outputArea );
	let outputOwner = null; // 'snapshot' | 'video' | 'pano'
	let currentTab = 'video';

	function refreshOutputVisibility() {

		outputArea.style.display = ( rendering || ( outputOwner !== null && outputOwner === currentTab ) ) ? '' : 'none';

	}

	function ownOutput( id ) {

		outputOwner = id;
		refreshOutputVisibility();

	}

	// Cancel belongs to whichever render is running, so it lives with the progress, not in one tab.
	const cancelRow = new UIRow();
	const cancelButton = new UIButton( 'Cancel' );
	cancelButton.dom.style.cssText = 'padding:6px 14px;border-radius:4px;display:none;';
	cancelButton.onClick( function () { cancelRequested = true; } );
	cancelRow.add( cancelButton );
	outputArea.appendChild( cancelRow.dom );

	// ── Progress bar + status ─────────────────────────────────────────────────

	const progressOuter = document.createElement( 'div' );
	progressOuter.style.cssText = 'height:8px;background:rgba(128,128,128,0.25);border-radius:4px;overflow:hidden;margin:10px 0 4px;display:none;';
	const progressInner = document.createElement( 'div' );
	progressInner.style.cssText = 'height:100%;width:0%;background:#08f;transition:width 0.1s linear;';
	progressOuter.appendChild( progressInner );
	outputArea.appendChild( progressOuter );

	const statusText = document.createElement( 'div' );
	statusText.style.cssText = 'font-size:11px;opacity:0.75;min-height:16px;margin-bottom:8px;';
	outputArea.appendChild( statusText );

	// Separate from statusText (setProgress() overwrites that via textContent
	// every call, which would wipe out any buttons appended into it).
	const postRenderActions = document.createElement( 'div' );
	postRenderActions.style.cssText = 'margin-bottom:8px;';
	outputArea.appendChild( postRenderActions );

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
	outputArea.appendChild( previewWrap );

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

	// 360 renders record MP4 and WebM in parallel (one recorder per supported
	// mime, off the SAME captured stream) when the browser supports both —
	// MP4 is what carries the embedded 360° metadata YouTube/VR players need,
	// WebM is offered alongside as a smaller/lossless-alpha-friendlier option.
	// Flat renders keep the single "best available" pick as before.
	function pickExportMimes( kind ) {

		if ( kind !== '360' ) {

			const m = pickMimeType();
			return m ? [ m ] : [];

		}

		const supported = ( m ) => window.MediaRecorder && MediaRecorder.isTypeSupported( m );
		const mp4 = [ 'video/mp4;codecs=avc1.42E01E', 'video/mp4' ].find( supported );
		const webm = [ 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm' ].find( supported );

		return [ mp4, webm ].filter( Boolean );

	}

	function extensionFor( mime ) {

		return mime.indexOf( 'mp4' ) !== - 1 ? 'mp4' : 'webm';

	}

	// Hands the thread back to the browser between offline frames (progress paints, Cancel is heard) without a timer,
	// so a background tab's timer throttling cannot slow it: a message to ourselves is delivered at once.
	const yieldChannel = new MessageChannel();
	function yieldToEventLoop() {

		return new Promise( resolve => { yieldChannel.port1.onmessage = () => resolve(); yieldChannel.port2.postMessage( 0 ); } );

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

	// ── Snapshot ──────────────────────────────────────────────────────────────

	let snapshotUrl = null; // object URL of the last preview image

	// Renders the scene once through `camera` on a throwaway WebGL renderer and
	// returns the canvas. Applies the same workarounds as the video render (the
	// live viewport may be a WebGPU renderer): its shadow maps and PMREM
	// environment are bound to its own context, and a Uint32 skinIndex breaks
	// the WebGL skinning shader. Everything is restored afterwards.
	function renderStill( camera, width, height, transparent ) {

		const scene = editor.scene;

		signals.pauseViewportRendering.dispatch();

		const restores = [];

		try {

			const shadowLights = [];
			scene.traverse( function ( o ) { if ( o.isLight && o.castShadow ) shadowLights.push( o ); } );

			const resetShadowMaps = function () {

				for ( const light of shadowLights ) {

					if ( light.shadow && light.shadow.map ) {

						if ( typeof light.shadow.map.dispose === 'function' ) light.shadow.map.dispose();
						light.shadow.map = null;

					}

					if ( light.shadow ) light.shadow.needsUpdate = true;

				}

			};

			resetShadowMaps();
			restores.push( resetShadowMaps );

			scene.traverse( function ( o ) {

				const attr = o.isSkinnedMesh && o.geometry.attributes.skinIndex;
				if ( attr && attr.array instanceof Uint32Array ) {

					o.geometry.setAttribute( 'skinIndex', new THREE.BufferAttribute( new Uint16Array( attr.array ), attr.itemSize ) );
					restores.push( () => o.geometry.setAttribute( 'skinIndex', attr ) );

				}

			} );

			const glCanvas = document.createElement( 'canvas' );
			glCanvas.width = width;
			glCanvas.height = height;

			const renderer = new THREE.WebGLRenderer( { canvas: glCanvas, antialias: true, alpha: true, preserveDrawingBuffer: true } );
			restores.push( () => renderer.dispose() );
			const output = new LinearOutput( renderer );
			restores.push( () => output.dispose() );
			renderer.setPixelRatio( 1 );
			renderer.setSize( width, height, false );
			renderer.setClearColor( transparent ? 0x000000 : RENDER_CLEAR_COLOR, transparent ? 0 : 1 );
			applyRenderSettings( renderer, editor.config );

			const env = webglEnvironment( renderer, scene );
			if ( env ) {

				const prevEnv = scene.environment;
				scene.environment = env.texture;
				restores.push( () => { scene.environment = prevEnv; env.dispose(); } );

			}

			// MToon / TSL node materials have no GLSL program: render them through WebGL stand-ins
			restores.push( swapNodeMaterials( scene ) );

			if ( transparent && scene.background ) {

				const prevBackground = scene.background;
				scene.background = null;
				restores.push( () => { scene.background = prevBackground; } );

			}

			const aspect = width / height;

			if ( camera.isPerspectiveCamera ) {

				const prevAspect = camera.aspect;
				camera.aspect = aspect;
				camera.updateProjectionMatrix();
				restores.push( () => { camera.aspect = prevAspect; camera.updateProjectionMatrix(); } );

			} else if ( camera.isOrthographicCamera ) {

				const prev = { left: camera.left, right: camera.right };
				camera.left = - aspect;
				camera.right = aspect;
				camera.updateProjectionMatrix();
				restores.push( () => { camera.left = prev.left; camera.right = prev.right; camera.updateProjectionMatrix(); } );

			}

			output.render( scene, camera );

			return glCanvas;

		} finally {

			for ( const restore of restores.reverse() ) {

				try { restore(); } catch ( e ) { console.warn( 'Snapshot cleanup failed', e ); }

			}

			signals.resumeViewportRendering.dispatch();
			signals.cameraChanged.dispatch( editor.viewportCamera );

		}

	}

	function snapshotMessage( text ) {

		progressOuter.style.display = 'none';
		statusText.textContent = text;

	}

	async function takeSnapshot() {

		if ( rendering ) return;

		const viewportEl = document.getElementById( 'viewport' );
		const sizeValue = snapSizeSelect.getValue();
		let width, height;

		if ( sizeValue.startsWith( 'viewport' ) ) {

			const k = sizeValue === 'viewport2x' ? 2 : 1;
			width = Math.round( ( viewportEl ? viewportEl.clientWidth : 1280 ) * k );
			height = Math.round( ( viewportEl ? viewportEl.clientHeight : 720 ) * k );

		} else {

			[ width, height ] = sizeValue.split( 'x' ).map( Number );

		}

		if ( ! ( width > 0 && height > 0 ) ) {

			snapshotMessage( 'Viewport has no size \u2014 cannot take a snapshot.' );
			return;

		}

		const camValue = snapCameraSelect.getValue();
		const camera = camValue === 'viewport' ? editor.viewportCamera : ( editor.cameras[ camValue ] || editor.viewportCamera );
		const format = snapFormatSelect.getValue();
		const mime = 'image/' + format;
		const transparent = snapTransparentCheckbox.getValue() && format !== 'jpeg';

		rendering = true;
		ownOutput( 'snapshot' );
		snapshotButton.dom.disabled = true;
		snapshotMessage( 'Taking snapshot\u2026' );
		await sleep( 30 ); // let the status paint before the synchronous render

		try {

			const glCanvas = renderStill( camera, width, height, transparent );

			// JPEG has no alpha: composite onto white. Going through a 2D canvas
			// also keeps toBlob independent of the WebGL drawing buffer.
			const out = document.createElement( 'canvas' );
			out.width = width;
			out.height = height;
			const ctx = out.getContext( '2d' );
			if ( format === 'jpeg' ) {

				ctx.fillStyle = '#ffffff';
				ctx.fillRect( 0, 0, width, height );

			}

			ctx.drawImage( glCanvas, 0, 0 );

			const blob = await new Promise( resolve => out.toBlob( resolve, mime, 0.92 ) );
			if ( ! blob ) throw new Error( 'The browser could not encode a ' + format.toUpperCase() + ' image' );

			const ext = format === 'jpeg' ? 'jpg' : format;
			const filename = `${ renderBaseName( { template: DEFAULT_SNAPSHOT_TEMPLATE, project: projectForNames(), camera: camera.name, width, height } ) }.${ ext }`;

			downloadBlob( blob, filename );

			// Preview + follow-up actions
			if ( snapshotUrl ) URL.revokeObjectURL( snapshotUrl );
			snapshotUrl = URL.createObjectURL( blob );

			const img = document.createElement( 'img' );
			img.src = snapshotUrl;
			img.style.cssText = 'width:100%;height:auto;display:block;' + ( transparent ? 'background:repeating-conic-gradient(#888 0% 25%, #bbb 0% 50%) 50% / 16px 16px;' : '' );
			previewWrap.innerHTML = '';
			previewWrap.appendChild( img );
			previewWrap.style.display = '';

			postRenderActions.innerHTML = '';

			const saveAgain = iconButton( 'download', 'Download again' );
			saveAgain.dom.style.cssText = 'height:22px;padding:0 8px;border-radius:4px;font-size:11px;margin-right:6px;';
			saveAgain.onClick( function () { downloadBlob( blob, filename ); } );
			postRenderActions.appendChild( saveAgain.dom );

			if ( window.ClipboardItem && navigator.clipboard && navigator.clipboard.write ) {

				const copyButton = new UIButton( 'Copy to clipboard' );
				copyButton.dom.style.cssText = 'height:22px;padding:0 8px;border-radius:4px;font-size:11px;';
				copyButton.onClick( async function () {

					try {

						// Clipboard images must be PNG
						const png = format === 'png' ? blob : await new Promise( resolve => out.toBlob( resolve, 'image/png' ) );
						await navigator.clipboard.write( [ new ClipboardItem( { 'image/png': png } ) ] );
						snapshotMessage( 'Snapshot copied to the clipboard.' );

					} catch ( e ) {

						snapshotMessage( 'Could not copy: ' + ( e && e.message ? e.message : e ) );

					}

				} );
				postRenderActions.appendChild( copyButton.dom );

			}

			snapshotMessage( `Saved ${ filename } (${ width } \u00d7 ${ height }, ${ ( blob.size / 1024 ).toFixed( 0 ) } KB).` );

		} catch ( e ) {

			console.error( 'Snapshot failed', e );
			snapshotMessage( 'Snapshot failed: ' + ( e && e.message ? e.message : e ) );

		} finally {

			rendering = false;
			refreshOutputVisibility();
			snapshotButton.dom.disabled = false;

		}

	}

	async function startRender( kind = 'flat' ) {

		if ( rendering ) return;

		const is360 = kind === '360';
		const S = is360 ? pano : flat; // this render's own settings: the 360° tab's, or the Video tab's

		const duration = timelineDuration();
		if ( ! ( duration > 0 ) ) {

			setProgress( 0, 'Timeline is empty — nothing to render.' );
			return;

		}

		const offline = S.modeSelect.getValue() === 'offline';
		const mimes = offline ? [] : pickExportMimes( kind );
		if ( ! offline && mimes.length === 0 ) {

			setProgress( 0, 'MediaRecorder video capture is not supported in this browser.' );
			return;

		}

		const shots = getShots().slice();
		const fallbackCamera = editor.camera; // no shots -> render through Edit Camera throughout
		const [ width, height ] = ( is360 ? equirectResolutionSelect : resolutionSelect ).getValue().split( 'x' ).map( Number );
		const fps = parseInt( S.fpsSelect.getValue(), 10 );
		const skip = S.skipSeconds( duration );
		const renderLength = S.outputDuration( duration );
		const totalFrames = frameCount( renderLength, fps );

		// Offline: pick an H.264 level this browser's encoder accepts, and the frame range, before anything is touched.
		let avc = null, range = { start: 0, end: totalFrames - 1, count: totalFrames };
		if ( offline ) {

			if ( ! window.VideoEncoder || ! window.VideoFrame ) {

				setProgress( 0, 'This browser has no WebCodecs video encoder. Switch Mode to Preview (realtime), or use a current Chrome, Edge or Safari.' );
				return;

			}

			if ( width % 2 || height % 2 ) {

				setProgress( 0, `H.264 needs even dimensions, got ${ width } \u00d7 ${ height }.` );
				return;

			}

			range = resolveRange( S.rangeStart.getValue().trim(), S.rangeEnd.getValue().trim(), totalFrames );
			if ( range.error ) {

				setProgress( 0, range.error );
				return;

			}

			for ( const codec of avcCodecCandidates( width, height, fps ) ) {

				const config = { codec, width, height, bitrate: targetBitrate( width, height, fps ), framerate: fps, avc: { format: 'avc' }, latencyMode: 'quality', hardwareAcceleration: S.encoderSelect.getValue() === 'software' ? 'prefer-software' : 'no-preference' };
				let support = null;
				try { support = await VideoEncoder.isConfigSupported( config ); } catch ( e ) { /* try the next level */ }
				if ( support && support.supported ) { avc = support.config; break; }

			}

			if ( ! avc ) {

				setProgress( 0, `This browser's encoder cannot do H.264 at ${ width } \u00d7 ${ height } and ${ fps } fps. Pick a smaller size or rate, or switch Mode to Preview (realtime).` );
				return;

			}

		}

		rendering = true;
		ownOutput( is360 ? 'pano' : 'video' );
		cancelRequested = false;
		renderButton.dom.disabled = true;
		equirectButton.dom.disabled = true;
		cancelButton.dom.style.display = '';
		showRenderOverlay();

		// Timeline playback samples the scene at a wall-clock playhead; left running it would fight the frame loop below
		// (offline especially: frame n must show n / fps and nothing else). Pause it, holding its pose; the render takes over.
		// Known residual: a render started while playback was running can differ by a few hundred scattered pixels per frame from
		// one started when idle (seeking does not do this; cause not found; see guides/TIME_SOURCES.md). Stop playback first.
		signals.timelinePauseRequested.dispatch();

		// Stop the live viewport's own renderer entirely while this offscreen one
		// runs — two renderer backends (e.g. the live WebGPURenderer + this
		// export's WebGLRenderer) touching the same scene's shared GPU resources
		// (light shadow maps in particular) at once corrupts/destroys them mid-submit.
		signals.pauseViewportRendering.dispatch();

		// A shadow-casting light's `shadow.map` render target is allocated by
		// whichever renderer backend last used it — the live viewport's
		// WebGPURenderer creates a WebGPU-native target (e.g. a point light's
		// CubeRenderTarget), which this renderer (always WebGL) can't reuse.
		// Silently corrupts the WHOLE shadow pass (not just that one light),
		// making most lit materials render solid black. Clear every
		// shadow-casting light's map so THIS renderer allocates its own
		// WebGL-compatible one; reset again in the `finally` below so the live
		// viewport regenerates its own WebGPU one next time it renders.
		const shadowLights = [];
		editor.scene.traverse( function ( o ) { if ( o.isLight && o.castShadow ) shadowLights.push( o ); } );
		function resetShadowMaps() {

			for ( const light of shadowLights ) {

				if ( light.shadow && light.shadow.map ) {

					if ( typeof light.shadow.map.dispose === 'function' ) light.shadow.map.dispose();
					light.shadow.map = null;

				}

				if ( light.shadow ) light.shadow.needsUpdate = true;

			}

		}
		resetShadowMaps();

		// WebGL binds a Uint32 skinIndex as an integer attribute, but the skinning
		// shader declares it as float — the draw call fails (INVALID_OPERATION) and
		// every skinned mesh silently renders nothing (a blank video). Swap in a
		// Uint16 copy for the duration of the render; restored in `finally`.
		const skinFixes = [];
		editor.scene.traverse( function ( o ) {

			const attr = o.isSkinnedMesh && o.geometry.attributes.skinIndex;
			if ( attr && attr.array instanceof Uint32Array ) {

				o.geometry.setAttribute( 'skinIndex', new THREE.BufferAttribute( new Uint16Array( attr.array ), attr.itemSize ) );
				skinFixes.push( () => o.geometry.setAttribute( 'skinIndex', attr ) );

			}

		} );

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
		const output = new LinearOutput( renderer );
		renderer.setPixelRatio( 1 );
		renderer.setSize( width, height, false );
		renderer.setClearColor( RENDER_CLEAR_COLOR ); // scene.background overrides
		applyRenderSettings( renderer, editor.config );

		// The viewport's PMREM environment cannot upload into this renderer (PBR would render
		// black): use an equivalent built in THIS context and restore the original afterwards.
		const scene = editor.scene;
		let restoreEnvironment = function () {};
		const env = webglEnvironment( renderer, scene );
		if ( env ) {

			const prevEnv = scene.environment;
			scene.environment = env.texture;
			restoreEnvironment = function () {

				scene.environment = prevEnv;
				env.dispose();

			};

		}

		// MToon / TSL node materials have no GLSL program, so this WebGL renderer would throw
		// compiling them: swap in WebGL stand-ins for the render, restore afterwards.
		const restoreMaterials = swapNodeMaterials( scene );

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
		// (Preview only. The offline render never touches a stream: its frames go straight to the encoder.)
		const stream = offline ? null : outCanvas.captureStream( fps );
		const videoTrack = offline ? null : stream.getVideoTracks()[ 0 ];

		// Downstream tools (ffmpeg -map 0:a, etc.) assume every exported video has
		// an audio channel — MediaRecorder's captureStream() has none by default,
		// so `-map 0:a` on the plain video-only output errors out with "Stream
		// map matches no streams". Add a real (silent) audio track: a zero-gain
		// constant source feeding a MediaStreamDestination, so the recorded file
		// always has one — just carrying silence.
		let audioCtx = null, silenceSource = null;
		if ( ! offline ) {

			const AudioCtx = window.AudioContext || window.webkitAudioContext;
			audioCtx = new AudioCtx();
			const audioDest = audioCtx.createMediaStreamDestination();
			const silenceGain = audioCtx.createGain();
			silenceGain.gain.value = 0;
			silenceSource = audioCtx.createConstantSource();
			silenceSource.connect( silenceGain ).connect( audioDest );
			silenceSource.start();
			for ( const track of audioDest.stream.getAudioTracks() ) stream.addTrack( track );

		}

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

		const makeRecorders = list => list.map( function ( m ) {

			const rec = new MediaRecorder( stream, {
				mimeType: m,
				videoBitsPerSecond: Math.min( 24_000_000, width * height * fps * 0.15 ),
			} );
			const chunks = [];
			rec.ondataavailable = e => { if ( e.data && e.data.size > 0 ) chunks.push( e.data ); };
			const stopped = new Promise( resolve => { rec.onstop = resolve; } );
			return { mime: m, recorder: rec, chunks, stopped };

		} );

		// Firefox (and some Linux builds) can report an MP4/H.264 mime as supported and
		// then throw from MediaRecorder.start(), or refuse the stream's silent audio
		// track. Try the picked mimes first, then WebM, then the same again without the
		// audio track, so a render doesn't die on the recorder.
		let recorders = [];
		const webmFallback = [ 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm' ].filter( m => window.MediaRecorder && MediaRecorder.isTypeSupported( m ) ).slice( 0, 1 );
		const startRecorders = () => {

			const attempts = [];
			for ( const withAudio of [ true, false ] ) {

				attempts.push( { list: mimes, withAudio } );
				if ( webmFallback.length && ! mimes.every( m => m.indexOf( 'webm' ) !== - 1 ) ) attempts.push( { list: webmFallback, withAudio } );

			}

			let lastError = null;
			for ( const a of attempts ) {

				if ( ! a.withAudio ) for ( const track of stream.getAudioTracks() ) stream.removeTrack( track );

				let made = [];
				try {

					made = makeRecorders( a.list );
					for ( const r of made ) r.recorder.start();
					recorders = made;
					return;

				} catch ( e ) {

					lastError = e;
					console.warn( `Render: recorder start failed for ${ a.list.join( ', ' ) }${ a.withAudio ? '' : ' (no audio track)' }`, e );
					for ( const r of made ) { try { if ( r.recorder.state !== 'inactive' ) r.recorder.stop(); } catch ( _ ) { /* already stopped */ } }

				}

			}

			throw lastError || new Error( 'MediaRecorder could not start' );

		};
		// Warm-up: the very first render of a scene compiles every shader and uploads
		// every texture / skinning buffer to the GPU, which can take several seconds
		// on a heavy scene. Done after recording starts, that stall freezes the first
		// frames and (the loop being wall-clock driven) skips the timeline ahead.
		// Render once through every camera BEFORE the recorders start so the loop's
		// frames all cost about the same.
		setProgress( 0, 'Preparing GPU resources\u2026' );
		await sleep( 30 ); // let the status paint
		const frameMs = 1000 / fps;

		// One output frame: through the current shot's camera (and the previous one's, blended, inside a fade), then the burned caption.
		// The GL fence comes first: nothing is read from the GL canvas until the GPU has finished drawing into it.
		const gl = renderer.getContext();
		function renderThrough( cam ) {

			if ( is360 ) renderEquirectFace( cam ); else output.render( scene, cam );
			gl.finish();

		}

		function drawFrame( outT, t, shotT ) {

			holdTimelineAt( editor, t );
			const state = shotStateAt( shotT );

			if ( state.from ) {

				// crossfade: previous shot full, current shot on top with alpha
				renderThrough( state.from );
				ctx.globalAlpha = 1;
				ctx.drawImage( glCanvas, 0, 0 );
				renderThrough( state.camera );
				ctx.globalAlpha = state.blend;
				ctx.drawImage( glCanvas, 0, 0 );
				ctx.globalAlpha = 1;

			} else {

				renderThrough( state.camera );
				ctx.drawImage( glCanvas, 0, 0 );

			}

			if ( S.burnCheckbox.getValue() ) {

				const cue = activeCueAt( getCues(), outT );
				if ( cue && cue.text ) drawBurnedCaption( ctx, width, height, cue.text );

			}

		}

		let muxer = null, encoder = null, encodeError = null;
		let renderError = null;

		try {

			// Inside the guarded block so a GPU failure here still restores the scene and the UI.
			if ( offline ) {

				// Settle the timeline: the sampler keeps some state between samples (what each text label last showed, its shadow and
				// fade slots), so the first pass over a freshly loaded scene left it slightly different from every later pass: frame n
				// could differ between the first render after a load and the next. Visit every frame once, in order, with no drawing,
				// so every render starts from the same state, whatever came before it and whatever range it covers.
				setProgress( 0, 'Settling the timeline\u2026' );
				for ( let n = 0; n < totalFrames; n ++ ) {

					if ( cancelRequested ) break;
					holdTimelineAt( editor, frameTimes( n, fps, skip, duration ).t );
					if ( n % 300 === 299 ) { setProgress( 0, `Settling the timeline\u2026 ${ n + 1 } / ${ totalFrames }` ); await yieldToEventLoop(); }

				}

			}

			holdTimelineAt( editor, Math.min( duration, skip ) );
			const warmCameras = new Set( [ fallbackCamera ] );
			for ( const s of shots ) warmCameras.add( cameraOf( s ) );
			for ( const cam of warmCameras ) {

				if ( is360 ) renderEquirectFace( cam ); else output.render( scene, cam );

			}

			ctx.drawImage( glCanvas, 0, 0 );
			await sleep( 0 );

			if ( offline ) {

				// The offline clock: frame n shows timeline time n / fps, and nothing else decides it. No requestAnimationFrame, no
				// wall clock, no sleeping to a schedule: a slow machine takes longer and writes the identical frames. (performance.now
				// below only measures speed for the estimate; it never feeds a frame time.)
				muxer = new Mp4Muxer( { width, height, fps } );
				encoder = new VideoEncoder( {
					output( chunk, meta ) {

						try {

							const data = new Uint8Array( chunk.byteLength );
							chunk.copyTo( data );
							const d = meta && meta.decoderConfig && meta.decoderConfig.description;
							const description = d ? ( ArrayBuffer.isView( d ) ? new Uint8Array( d.buffer.slice( d.byteOffset, d.byteOffset + d.byteLength ) ) : new Uint8Array( d.slice( 0 ) ) ) : undefined;
							muxer.addChunk( data, { key: chunk.type === 'key', timestampUs: chunk.timestamp, description } );

						} catch ( e ) {

							encodeError = encodeError || e;

						}

					},
					error( e ) { encodeError = encodeError || e; },
				} );
				encoder.configure( avc );

				const keyEvery = fps * 2; // a keyframe every two seconds of timeline, on absolute frame numbers, plus the first frame of a range
				const started = performance.now();
				let done = 0;

				for ( let n = range.start; n <= range.end; n ++ ) {

					if ( cancelRequested ) break;
					if ( encodeError ) throw encodeError;

					const { outT, t, shotT } = frameTimes( n, fps, skip, duration );
					drawFrame( outT, t, shotT );

					const frame = new VideoFrame( outCanvas, { timestamp: frameTimestampUs( n, fps ), duration: frameDurationUs( fps ) } );
					container.dom.dispatchEvent( new CustomEvent( 'render-frame', { detail: { frame: n, time: t, canvas: outCanvas } } ) );
					encoder.encode( frame, { keyFrame: n === range.start || n % keyEvery === 0 } );
					frame.close();
					done ++;

					// bounded queue: wait for the encoder to drain by its own event, not for a timer
					while ( encoder.encodeQueueSize > 6 ) await new Promise( resolve => encoder.addEventListener( 'dequeue', resolve, { once: true } ) );

					const perFrame = ( performance.now() - started ) / done;
					const left = ( range.end - n ) * perFrame / 1000;
					setProgress( done / range.count, `Frame ${ n } of ${ range.end } (${ done } / ${ range.count }) \u00b7 timeline ${ t.toFixed( 2 ) } s \u00b7 ${ ( 1000 / perFrame ).toFixed( 1 ) } frames/s \u00b7 about ${ left < 90 ? Math.round( left ) + ' s' : Math.round( left / 60 ) + ' min' } left` );
					await yieldToEventLoop();

				}

				if ( ! cancelRequested ) {

					await encoder.flush();
					if ( encodeError ) throw encodeError;
					if ( muxer.frameCount !== range.count ) throw new Error( `Encoder returned ${ muxer.frameCount } frames for ${ range.count } requested.` );
					try { localStorage.setItem( MS_PER_FRAME_KEY, String( ( performance.now() - started ) / range.count ) ); } catch ( e ) { /* storage blocked */ }

				}

			} else {

				startRecorders();

				// Preview: wall-clock driven. MediaRecorder timestamps frames by real time, so sampling the timeline at the true
				// elapsed time keeps the video the right length even when the browser throttles timers (a background tab);
				// throttling just drops frames. NOT reproducible, and says so. `elapsed` is OUTPUT video time; content time is
				// offset by `skip` and clamped to `duration` so the tail seconds hold the last frame frozen.
				const startWall = performance.now();
				let frameIndex = 0, drawn = 0;

				while ( true ) {

					if ( cancelRequested ) break;

					const elapsed = ( performance.now() - startWall ) / 1000;
					const outT = Math.min( renderLength, elapsed );
					const t = Math.min( duration, skip + outT );

					// Shot/camera-cut blend time is intentionally NOT clamped to `duration` like `t` — a shot cut placed
					// right at the timeline's end (e.g. a fade into a trailing call card) would otherwise freeze stuck at
					// the START of its transition for the whole tail, instead of finishing the fade.
					drawFrame( outT, t, skip + outT );
					drawn ++;

					if ( videoTrack.requestFrame ) videoTrack.requestFrame();

					const tail = t >= duration && outT < renderLength ? ' (holding final frame)' : '';
					// Name the degradation while it happens, so nobody tunes against a degraded preview and blames the render
					const achieved = elapsed > 1 ? drawn / elapsed : fps;
					const degraded = achieved < fps * 0.92 ? ` \u00b7 preview: ${ Math.round( achieved ) } fps, dropping frames` : '';
					setProgress( outT / renderLength, `Previewing ${ outT.toFixed( 2 ) }s / ${ renderLength.toFixed( 2 ) }s${ tail }${ degraded }` );

					if ( outT >= renderLength ) break;

					// Pace against the absolute frame schedule, not "render time + frameMs": sleeping a full frame after the
					// work made every frame cost render + frameMs, so the real rate fell below `fps` and the recording stuttered.
					frameIndex = Math.max( frameIndex + 1, Math.ceil( ( performance.now() - startWall ) / frameMs ) ); // skip, don't burst, if we fell behind
					await sleep( Math.max( 0, startWall + frameIndex * frameMs - performance.now() ) );

				}

			}

		} catch ( e ) {

			renderError = e;

		} finally {

			if ( encoder && encoder.state !== 'closed' ) { try { encoder.close(); } catch ( e ) { /* already closed */ } }

			const live = recorders.filter( r => r.recorder.state !== 'inactive' );
			for ( const r of live ) r.recorder.stop();
			await Promise.all( live.map( r => r.stopped ) );

			if ( silenceSource ) silenceSource.stop();
			if ( audioCtx ) audioCtx.close();

			for ( const restore of cameraRestores ) restore();
			for ( const restore of skinFixes ) restore();
			restoreEnvironment();
			restoreMaterials();
			resetShadowMaps(); // this renderer's WebGL shadow maps are just as invalid for the live WebGPU viewport — force it to regenerate its own
			holdTimelineAt( editor, 0 );
			signals.sceneGraphChanged.dispatch();
			// Dispose the cube render target BEFORE the renderer itself — the
			// renderer needs its still-intact internal GPU-resource bookkeeping to
			// deallocate the render target's framebuffers; disposing the renderer
			// first leaves that bookkeeping cleared, so the target's own dispose()
			// throws reading into an already-emptied framebuffer list.
			if ( is360 ) {

				cubeRenderTarget.dispose();
				equirectMaterial.dispose();
				quadGeometry.dispose();

			}

			output.dispose();
			renderer.dispose();

			rendering = false;
			refreshOutputVisibility();
			cancelButton.dom.style.display = 'none';
			hideRenderOverlay();
			signals.resumeViewportRendering.dispatch();
			updateDuration(); // re-enables the render button if timeline non-empty

		}

		if ( renderError ) {

			console.error( 'Render failed', renderError );
			setProgress( 0, 'Render failed: ' + ( renderError && renderError.message ? renderError.message : renderError ) );
			previewWrap.style.display = 'none';
			return;

		}

		if ( cancelRequested ) {

			setProgress( 0, 'Render cancelled.' );
			previewWrap.style.display = 'none';
			return;

		}

		// a partial range is named for its frames, so it cannot be mistaken for the whole film when it is spliced in
		const partial = offline && ( range.start !== 0 || range.end !== totalFrames - 1 );
		const baseName = S.videoBaseName( { width, height, fps, duration: S.outputDuration( duration ) } ) + ( partial ? `_frames-${ range.start }-${ range.end }` : '' );

		// One output per recorder (360 mode may have recorded MP4 + WebM in
		// parallel off the same stream) — MP4 first so it's always the
		// auto-downloaded "primary" file when both are available.
		const outputs = [];
		if ( offline ) {

			// 360: the metadata box goes into the muxer, which writes the sample offsets knowing it is there
			const blob = new Blob( muxer.finish( is360 ? [ sphericalMetadataBox() ] : [] ), { type: 'video/mp4' } );

			outputs.push( { blob, ext: 'mp4', isMp4: true } );

		}

		for ( const r of recorders ) {

			const ext = extensionFor( r.mime );
			const isMp4 = ext === 'mp4';
			let blob = new Blob( r.chunks, { type: r.mime.split( ';' )[ 0 ] } );

			if ( is360 && isMp4 ) {

				setProgress( 1, 'Embedding 360\u00b0 metadata\u2026' );
				blob = await injectSphericalMetadata( blob );

			}

			outputs.push( { blob, ext, isMp4 } );

		}

		const [ primary, ...extraOutputs ] = outputs;
		downloadBlob( primary.blob, `${ baseName }.${ primary.ext }` );

		postRenderActions.innerHTML = '';

		// A second automatic download() right after the first is silently
		// blocked by Chrome/Firefox's multi-download abuse guard (no new user
		// gesture in between) — confirmed empirically, the .srt never reached
		// disk. Surface a real button instead: a genuine click always passes.
		for ( const extra of extraOutputs ) {

			const extraButton = iconButton( 'download', `Download .${ extra.ext } version` );
			extraButton.dom.style.cssText = 'height:22px;padding:0 8px;border-radius:4px;font-size:11px;margin-right:6px;';
			extraButton.onClick( function () { downloadBlob( extra.blob, `${ baseName }.${ extra.ext }` ); } );
			postRenderActions.appendChild( extraButton.dom );

		}

		if ( S.sidecarCheckbox.getValue() && getCues().length > 0 ) {

			const srtLink = iconButton( 'download', 'Download matching .srt' );
			srtLink.dom.style.cssText = 'height:22px;padding:0 8px;border-radius:4px;font-size:11px;';
			srtLink.onClick( function () {

				downloadBlob( new Blob( [ cuesToSrt( getCues() ) ], { type: 'text/plain' } ), `${ baseName }.srt` );

			} );
			postRenderActions.appendChild( srtLink.dom );

		}

		if ( offline ) {

			setProgress( 1, `Done \u2014 ${ range.count.toLocaleString( 'en-US' ) } frames at exactly ${ fps }.000 fps, video downloaded${ partial ? ` (frames ${ range.start }\u2013${ range.end }: splice it in at frame ${ range.start })` : '' }.${ is360 ? ' 360\u00b0 metadata embedded.' : '' }` );

		} else if ( ! is360 ) {

			setProgress( 1, 'Done \u2014 video downloaded.' );

		} else if ( extraOutputs.length > 0 ) {

			setProgress( 1, 'Done \u2014 360\u00b0 video downloaded as MP4 (metadata embedded for YouTube/VR players); a WebM version is also available below.' );

		} else if ( primary.isMp4 ) {

			setProgress( 1, 'Done \u2014 360\u00b0 video downloaded (metadata embedded for YouTube/VR players).' );

		} else {

			setProgress( 1, 'Done \u2014 360\u00b0 video downloaded. Your browser only supports WebM recording \u2014 360\u00b0 metadata is only embedded in MP4 output, so this file won\u2019t be recognized as a 360 video by YouTube/VR players.' );

		}

	}

	updateDuration();
	for ( const S of allSettings ) S.refreshMode();
	refreshSequencer();

	let startTab = 'video';
	try { startTab = localStorage.getItem( SUBTAB_KEY ) || 'video'; } catch ( e ) { /* storage blocked */ }
	selectRenderTab( startTab );

	return container;

}

export { SidebarRender };
