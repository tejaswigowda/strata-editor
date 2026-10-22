import { UIPanel } from './libs/ui.js';
import { formatClock } from './TimeFormat.js';
import { shotCameraName } from './ShotAt.js';

// ── PlayBar.js ────────────────────────────────────────────────────────────────
// A QuickTime-style transport controller that takes the place of the menubar
// while the Universal Timeline plays: play, pause, stop, a seek bar and
// current / total time. It opens when playback starts and its cancel button
// closes it and brings the regular menubar back (playback is left alone).
// Like PresentBar it talks to Timeline.js only through signals, so it never
// owns the clock. body.play-bar-open swaps #menubar for #play-bar (main.css).
// A small chip beside the clock names the camera of the current shot (the Render
// tab's camera sequence at the playhead, else the active / followed camera), and
// a few seconds into playback the bar fades to a low-opacity strip while the mouse
// is away; moving over the top strip, hovering or focusing it, or pausing brings it back.

const FADE_DELAY = 3000; // ms of playback with the pointer away before the bar dims
const WAKE_STRIP = 56; // px from the top of the window that counts as "over the bar"

function PlayBar( editor ) {

	const signals = editor.signals;

	const container = new UIPanel();
	container.setId( 'play-bar' );

	const playIcon = '<svg width="14" height="14" viewBox="0 0 12 12"><path d="M3 1.5v9l7-4.5z" fill="currentColor"/></svg>';
	const pauseIcon = '<svg width="14" height="14" viewBox="0 0 12 12"><path d="M2 1h3v10H2zM7 1h3v10H7z" fill="currentColor"/></svg>';
	const stopIcon = '<svg width="14" height="14" viewBox="0 0 12 12"><rect x="2" y="2" width="8" height="8" fill="currentColor"/></svg>';
	const closeIcon = '<svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

	function button( cls, html, title, onClick ) {

		const b = document.createElement( 'button' );
		b.className = 'play-bar-button ' + cls;
		b.innerHTML = html;
		b.title = title;
		b.addEventListener( 'click', onClick );
		container.dom.appendChild( b );
		return b;

	}

	let isPlaying = false;
	let scrubbing = false; // while dragging the seek bar, incoming playhead updates must not fight the drag

	const playButton = button( 'play', playIcon, 'Play', function () { signals.timelinePlayRequested.dispatch(); } );
	const pauseButton = button( 'pause', pauseIcon, 'Pause', function () { signals.timelinePauseRequested.dispatch(); } );
	button( 'stop', stopIcon, 'Stop (rewind to 0)', function () { signals.timelineStopRequested.dispatch(); } );

	const seek = document.createElement( 'input' );
	seek.type = 'range';
	seek.min = '0';
	seek.max = '0';
	seek.step = '0.01';
	seek.value = '0';
	container.dom.appendChild( seek );

	const timeLabel = document.createElement( 'div' );
	timeLabel.className = 'play-bar-time';
	timeLabel.textContent = '00:00 / 00:00';
	container.dom.appendChild( timeLabel );

	const shotChip = document.createElement( 'div' );
	shotChip.className = 'play-bar-shot';
	shotChip.setAttribute( 'aria-label', 'Current camera' );
	shotChip.hidden = true;
	container.dom.appendChild( shotChip );

	button( 'cancel', closeIcon, 'Close the play bar and show the menu bar', close );

	// ── auto-fade ────────────────────────────────────────────────────────────
	let fadeTimer = null;
	let pointerOver = false;

	function wake() {

		clearTimeout( fadeTimer );
		container.dom.classList.remove( 'faded' );
		if ( isPlaying && ! pointerOver && ! container.dom.contains( document.activeElement ) ) {

			fadeTimer = setTimeout( function () { container.dom.classList.add( 'faded' ); }, FADE_DELAY );

		}

	}

	container.dom.addEventListener( 'pointerenter', function () { pointerOver = true; wake(); } );
	container.dom.addEventListener( 'pointerleave', function () { pointerOver = false; wake(); } );
	container.dom.addEventListener( 'focusin', wake );
	container.dom.addEventListener( 'focusout', wake );

	document.addEventListener( 'pointermove', function ( event ) {

		if ( event.clientY <= WAKE_STRIP && document.body.classList.contains( 'play-bar-open' ) ) wake();

	} );

	function open() {

		document.body.classList.add( 'play-bar-open' );
		wake();

	}

	function close() {

		document.body.classList.remove( 'play-bar-open' );
		clearTimeout( fadeTimer );
		container.dom.classList.remove( 'faded' );

	}

	function setPlayingUI( info ) {

		const playing = !! info.playing;
		const changed = playing !== isPlaying;
		isPlaying = playing;
		playButton.classList.toggle( 'active', isPlaying );
		pauseButton.classList.toggle( 'active', ! isPlaying && info.time > 0 && info.time < info.duration );
		if ( changed ) wake(); // starts the fade countdown on play, restores the bar on pause

	}

	function updateShotChip( time ) {

		const shots = editor.scene.userData && editor.scene.userData.renderShots;
		const name = shotCameraName( shots, time, editor.cameras, editor.viewportCamera );
		if ( name !== shotChip.textContent ) shotChip.textContent = name;
		shotChip.title = name ? 'Camera at the playhead: ' + name : '';
		shotChip.hidden = name === '';

	}

	seek.addEventListener( 'mousedown', function () { scrubbing = true; } );
	seek.addEventListener( 'touchstart', function () { scrubbing = true; } );

	seek.addEventListener( 'input', function () {

		signals.timelineSeekRequested.dispatch( parseFloat( seek.value ) );

	} );

	seek.addEventListener( 'change', function () {

		scrubbing = false;
		signals.timelineSeekRequested.dispatch( parseFloat( seek.value ) );

	} );

	signals.timelinePlayheadUpdated.add( function ( info ) {

		const duration = info.duration || 0;
		seek.max = String( Math.max( duration, 0.01 ) );
		if ( ! scrubbing ) seek.value = String( info.time );
		timeLabel.textContent = `${ formatClock( info.time ) } / ${ formatClock( duration ) }`;
		updateShotChip( info.time );

		if ( info.playing && ! isPlaying && ! document.body.classList.contains( 'present-mode' ) ) open();
		setPlayingUI( info );

	} );

	signals.editorCleared.add( close );
	signals.editCameraSelected.add( close );

	return container;

}

export { PlayBar };
