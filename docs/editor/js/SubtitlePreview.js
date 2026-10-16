import { normalizeCues, activeCueAt } from './intelligence/subtitles.js';

// ── SubtitlePreview.js ────────────────────────────────────────────────────────
// Shows the subtitle cue that is active at the timeline playhead over the
// viewport, so the cue timing can be judged against the picture while playing
// or scrubbing. Display only: the cues themselves live on the scene
// (scene.userData.renderSubtitles) and are edited from the Render tab; this
// re-reads them whenever they change, from anywhere.

function SubtitlePreview( editor ) {

	const signals = editor.signals;

	const dom = document.createElement( 'div' );
	dom.id = 'subtitle-preview';
	const text = document.createElement( 'span' );
	dom.appendChild( text );

	let cues = [];
	let time = 0;
	let shownText = null;

	function read() {

		cues = normalizeCues( editor.scene.userData && editor.scene.userData.renderSubtitles );
		update();

	}

	function update() {

		const cue = activeCueAt( cues, time );
		const next = cue && cue.text.trim() ? cue.text : null;
		if ( next === shownText ) return;
		shownText = next;
		text.textContent = next || '';
		dom.style.display = next ? 'flex' : 'none';

	}

	signals.timelinePlayheadUpdated.add( function ( info ) { time = info.time; update(); } );
	signals.subtitlesChanged.add( read );
	signals.sceneGraphChanged.add( read );
	signals.editorCleared.add( read );
	signals.historyChanged.add( read );

	read();

	return { dom };

}

export { SubtitlePreview };
