import { Command } from '../Command.js';
import { applyCustomize } from '../customize/customizeOps.js';
import { rigFingerprint } from '../customize/rigSafety.js';
import { skinGarmentToBody } from '../customize/rigSteps.js';

function refresh( editor, root ) {

	editor.signals.sceneGraphChanged.dispatch();
	if ( root ) editor.signals.objectChanged.dispatch( root );

}

function syncCameras( editor ) {

	const live = new Set();
	editor.scene.traverse( o => { if ( o.isCamera ) live.add( o ); } );
	live.forEach( c => editor.addCamera( c ) );
	Object.values( editor.cameras ).forEach( c => { if ( c !== editor.camera && ! live.has( c ) && c.userData.customizer ) editor.removeCamera( c ); } );

}

/**
 * Apply rig-safe customize ops to a character as ONE undoable step, and keep the
 * ops (and the rig fingerprint taken before the first one) on the character's
 * userData.customize so the scene carries its own spec — replayable headlessly.
 */
class CustomizeCommand extends Command {

	constructor( editor, root = null, ops = [], name = 'Customize' ) {

		super( editor );

		this.type = 'CustomizeCommand';
		this.name = name;
		this.root = root;
		this.ops = ops;
		this.result = null;
		this.hadRecord = false;

	}

	execute() {

		const root = this.root;
		this.hadRecord = !! root.userData.customize;
		const baseline = this.hadRecord ? null : rigFingerprint( root );

		this.result = applyCustomize( root, this.ops, { scene: this.editor.scene } );

		const record = root.userData.customize || ( root.userData.customize = { rig: baseline.all, ops: [] } );
		record.ops = [ ...record.ops, ...JSON.parse( JSON.stringify( this.ops ) ) ];

		syncCameras( this.editor );
		refresh( this.editor, this.root );

	}

	undo() {

		if ( ! this.result ) return;
		this.result.undo();
		this.result = null;

		const record = this.root.userData.customize;
		if ( record ) {

			record.ops = record.ops.slice( 0, record.ops.length - this.ops.length );
			if ( ! this.hadRecord ) delete this.root.userData.customize;

		}

		syncCameras( this.editor );
		refresh( this.editor, this.root );

	}

	// Not restorable from a saved history: re-run the spec from userData.customize instead.
	fromJSON( json ) {

		super.fromJSON( json );
		this.result = null;

	}

}

/** Rig step (NOT a customize op): skin a selected garment mesh to the character's body skeleton. */
class SkinGarmentCommand extends Command {

	constructor( editor, root = null, garment = null ) {

		super( editor );

		this.type = 'SkinGarmentCommand';
		this.name = 'Skin garment to body (rig step)';
		this.root = root;
		this.garment = garment;
		this.skinned = null;
		this.parent = garment ? garment.parent : null;

	}

	execute() {

		this.garment.userData.garment = true;
		this.parent = this.garment.parent;
		this.skinned = skinGarmentToBody( this.garment, this.root );
		refresh( this.editor, this.root );

	}

	undo() {

		if ( ! this.skinned ) return;
		this.skinned.removeFromParent();
		if ( this.parent ) this.parent.add( this.garment );
		this.skinned = null;
		refresh( this.editor, this.root );

	}

	fromJSON( json ) {

		super.fromJSON( json );
		this.skinned = null;

	}

}

export { CustomizeCommand, SkinGarmentCommand };
