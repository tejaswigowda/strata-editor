import { UIPanel } from './libs/ui.js';
import { formatClock } from './TimeFormat.js';

// ── PlayBar.js ────────────────────────────────────────────────────────────────
// A QuickTime-style transport controller that takes the place of the menubar
// while the Universal Timeline plays: play, pause, stop, a seek bar and
// current / total time. It opens when playback starts and its cancel button
// closes it and brings the regular menubar back (playback is left alone).
// Like PresentBar it talks to Timeline.js only through signals, so it never
// owns the clock. body.play-bar-open swaps #menubar for #play-bar (main.css).

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

	button( 'cancel', closeIcon, 'Close the play bar and show the menu bar', close );

	function open() {

		document.body.classList.add( 'play-bar-open' );

	}

	function close() {

		document.body.classList.remove( 'play-bar-open' );

	}

	function setPlayingUI( info ) {

		isPlaying = !! info.playing;
		playButton.classList.toggle( 'active', isPlaying );
		pauseButton.classList.toggle( 'active', ! isPlaying && info.time > 0 && info.time < info.duration );

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

		if ( info.playing && ! isPlaying && ! document.body.classList.contains( 'present-mode' ) ) open();
		setPlayingUI( info );

	} );

	signals.editorCleared.add( close );
	signals.editCameraSelected.add( close );

	return container;

}

export { PlayBar };
