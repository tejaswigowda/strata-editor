import { Command } from '../Command.js';
import { TimelineModel } from '../intelligence/timeline.js';
import { syncTimeline } from '../intelligence/timelineController.js';

/**
 * Set the entire scene-wide timeline to a new absolute-time representation.
 * Command-backed so every timeline edit — authored via $S .then() sugar, dragged
 * in the Animations tab, or added at the playhead — goes through the ONE
 * execution surface (undoable / versioned) like every other op.
 *
 * @param {Editor} editor
 * @param {object} nextJSON  serialized TimelineModel (the new state)
 * @param {string} [name]    undo-stack label
 */
class SetTimelineCommand extends Command {

	constructor( editor, nextJSON = null, name = 'Edit Timeline' ) {

		super( editor );

		this.type = 'SetTimelineCommand';
		this.name = name;

		this.prevJSON = editor.timeline ? editor.timeline.toJSON() : { duration: 0, tracks: [] };
		this.nextJSON = nextJSON || this.prevJSON;

	}

	execute() {

		this.editor.timeline = TimelineModel.fromJSON( this.nextJSON );
		syncTimeline( this.editor );

	}

	undo() {

		this.editor.timeline = TimelineModel.fromJSON( this.prevJSON );
		syncTimeline( this.editor );

	}

	toJSON() {

		const output = super.toJSON( this );
		output.prevJSON = this.prevJSON;
		output.nextJSON = this.nextJSON;
		return output;

	}

	fromJSON( json ) {

		super.fromJSON( json );
		this.prevJSON = json.prevJSON;
		this.nextJSON = json.nextJSON;

	}

}

export { SetTimelineCommand };
