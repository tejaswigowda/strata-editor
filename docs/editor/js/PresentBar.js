import { UIPanel } from './libs/ui.js';

// ── PresentBar.js ─────────────────────────────────────────────────────────────
// The entire chrome shown in Present mode (#...&present=true — see index.html
// and main.css's body.present-mode rules, which hide the menubar/toolbar/
// sidebar and let #viewport fill the screen). Transport controls for the
// Universal Timeline (play/pause, stop, seek) plus one way back into the full
// editor (Remix) — no other editing affordances. Talks to Timeline.js purely
// through signals (play/pause/stop/seek requests out, timelinePlayheadUpdated
// in) so it never needs to own or duplicate the timeline clock.

function PresentBar( editor ) {

	const signals = editor.signals;

	const container = new UIPanel();
	container.setId( 'present-bar' );

	const playIcon = '<svg width="14" height="14" viewBox="0 0 12 12"><path d="M3 1.5v9l7-4.5z" fill="currentColor"/></svg>';
	const pauseIcon = '<svg width="14" height="14" viewBox="0 0 12 12"><path d="M2 1h3v10H2zM7 1h3v10H7z" fill="currentColor"/></svg>';
	const stopIcon = '<svg width="14" height="14" viewBox="0 0 12 12"><rect x="2" y="2" width="8" height="8" fill="currentColor"/></svg>';

	let isPlaying = false;
	let scrubbing = false; // true while the user is dragging the seek bar — suppresses incoming playhead updates so they don't fight the drag

	const playButton = document.createElement( 'button' );
	playButton.innerHTML = playIcon;
	playButton.title = 'Play';
	container.dom.appendChild( playButton );

	const stopButton = document.createElement( 'button' );
	stopButton.innerHTML = stopIcon;
	stopButton.title = 'Stop (rewind to 0)';
	container.dom.appendChild( stopButton );

	const seek = document.createElement( 'input' );
	seek.type = 'range';
	seek.min = '0';
	seek.max = '0';
	seek.step = '0.01';
	seek.value = '0';
	container.dom.appendChild( seek );

	const timeLabel = document.createElement( 'div' );
	timeLabel.className = 'present-time';
	timeLabel.textContent = '0.00 / 0.00';
	container.dom.appendChild( timeLabel );

	// Remix: drop back into the full editor on the SAME scene — reloads with
	// `present` stripped from the hash (a hash-only change alone wouldn't
	// re-run the app's boot-time hash loader, so it's followed by an explicit
	// reload). Every other param (repo/file/branch/play/...) is left untouched.
	const remixButton = document.createElement( 'button' );
	remixButton.className = 'present-remix';
	remixButton.textContent = 'Remix';
	remixButton.title = 'Open the full editor on this scene';
	remixButton.addEventListener( 'click', function () {

		const params = new URLSearchParams( window.location.hash.replace( /^#+/, '' ) );
		params.delete( 'present' );
		const rest = params.toString();
		window.location.hash = rest ? '#' + rest : '';
		window.location.reload();

	} );
	container.dom.appendChild( remixButton );

	function setPlayingUI( playing ) {

		isPlaying = playing;
		playButton.innerHTML = playing ? pauseIcon : playIcon;
		playButton.title = playing ? 'Pause' : 'Play';

	}

	playButton.addEventListener( 'click', function () {

		if ( isPlaying ) signals.timelinePauseRequested.dispatch();
		else signals.timelinePlayRequested.dispatch();

	} );

	stopButton.addEventListener( 'click', function () {

		signals.timelineStopRequested.dispatch();

	} );

	function beginScrub() { scrubbing = true; }

	seek.addEventListener( 'mousedown', beginScrub );
	seek.addEventListener( 'touchstart', beginScrub );

	seek.addEventListener( 'input', function () {

		// Live-scrub: reflect the drag position in the scene as it happens.
		signals.timelineSeekRequested.dispatch( parseFloat( seek.value ) );

	} );

	seek.addEventListener( 'change', function () {

		scrubbing = false;
		signals.timelineSeekRequested.dispatch( parseFloat( seek.value ) );

	} );

	signals.timelinePlayheadUpdated.add( function ( info ) {

		const duration = info.duration || 0;
		seek.max = String( Math.max( duration, 0.01 ) );
		setPlayingUI( !! info.playing );

		if ( ! scrubbing ) seek.value = String( info.time );

		timeLabel.textContent = `${ info.time.toFixed( 2 ) } / ${ duration.toFixed( 2 ) }`;

	} );

	return container;

}

export { PresentBar };
