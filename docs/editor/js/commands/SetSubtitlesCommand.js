import { Command } from '../Command.js';
import { normalizeCues } from '../intelligence/subtitles.js';

/**
 * Replace the scene's subtitle cues (scene.userData.renderSubtitles). The cues
 * live on the scene, so executing this changes the scene JSON; it also goes
 * through the command history, which means it is undoable AND triggers the
 * editor's autosave (historyChanged), exactly like any other scene edit.
 * `subtitlesChanged` tells every view of the cues (the Render tab list, the
 * viewport caption preview, the shell) to re-read them.
 *
 * @param {Editor} editor
 * @param {Array}  nextCues  the new cue list (normalized here)
 * @param {string} [name]    undo-stack label
 */
class SetSubtitlesCommand extends Command {

	constructor( editor, nextCues = [], name = 'Edit Subtitles' ) {

		super( editor );

		this.type = 'SetSubtitlesCommand';
		this.name = name;

		const ud = editor.scene.userData || {};
		this.prevCues = normalizeCues( ud.renderSubtitles );
		this.nextCues = normalizeCues( nextCues );

	}

	apply( cues ) {

		const scene = this.editor.scene;
		scene.userData = scene.userData || {};
		if ( cues.length > 0 ) scene.userData.renderSubtitles = cues.map( c => ( { ...c } ) );
		else delete scene.userData.renderSubtitles; // an empty list is simply "no subtitles" in the scene JSON
		this.editor.signals.subtitlesChanged.dispatch( cues );

	}

	execute() {

		this.apply( this.nextCues );

	}

	undo() {

		this.apply( this.prevCues );

	}

	toJSON() {

		const output = super.toJSON( this );
		output.prevCues = this.prevCues;
		output.nextCues = this.nextCues;
		return output;

	}

	fromJSON( json ) {

		super.fromJSON( json );
		this.prevCues = json.prevCues;
		this.nextCues = json.nextCues;

	}

}

export { SetSubtitlesCommand };
