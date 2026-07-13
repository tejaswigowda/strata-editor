// ── StrataHost.js — Strata as a CONSUMER of @tejaswigowda/3dom ──────────────────
//
// The 3DOM library (docs/packages/3dom) is runtime-free: its ops never import a
// command class or an editor. They call **Host factories**. This adapter is the
// Strata implementation of that Host contract — it maps every factory onto a real
// Strata command and routes execution through editor.execute() so 3DOM edits land
// in Strata's own undo/redo history and fire its signals, behaving IDENTICALLY to
// hand-written editOps.
//
//   import createS from '/packages/3dom/src/index.js';
//   import { StrataHost } from './intelligence/StrataHost.js';
//   const $S = createS( new StrataHost( editor ) );
//   $S('.wheel').recolor('#111');   // → SetMaterialColorCommand via editor.execute

import { SetPositionCommand } from '../commands/SetPositionCommand.js';
import { SetRotationCommand } from '../commands/SetRotationCommand.js';
import { SetScaleCommand } from '../commands/SetScaleCommand.js';
import { SetValueCommand } from '../commands/SetValueCommand.js';
import { SetColorCommand } from '../commands/SetColorCommand.js';
import { SetMaterialColorCommand } from '../commands/SetMaterialColorCommand.js';
import { SetMaterialValueCommand } from '../commands/SetMaterialValueCommand.js';
import { SetMaterialCommand } from '../commands/SetMaterialCommand.js';
import { AddObjectCommand } from '../commands/AddObjectCommand.js';
import { RemoveObjectCommand } from '../commands/RemoveObjectCommand.js';
import { MultiCmdsCommand } from '../commands/MultiCmdsCommand.js';

/**
 * A Host backed by the Strata editor. Every command factory returns a real Strata
 * command; execute()/undo()/redo() delegate to the editor's history; notify()
 * dispatches the editor's signals so the UI refreshes.
 */
export class StrataHost {

	constructor( editor ) {

		this.editor = editor;

	}

	get scene() {

		return this.editor.scene;

	}

	// ── Command factories (the Host contract) ─────────────────────────────────
	// Each returns a real Strata command instance. materialSlot follows Strata's
	// convention: -1 addresses the object's single/whole material, matching the
	// editor's own recolor path.

	setPosition( object, vec ) { return new SetPositionCommand( this.editor, object, vec ); }
	setRotation( object, euler ) { return new SetRotationCommand( this.editor, object, euler ); }
	setScale( object, vec ) { return new SetScaleCommand( this.editor, object, vec ); }
	setValue( object, key, value ) { return new SetValueCommand( this.editor, object, key, value ); }
	setColor( object, key, hex ) { return new SetColorCommand( this.editor, object, key, hex ); }

	setMaterialColor( object, key, hex, slot = - 1 ) {

		return new SetMaterialColorCommand( this.editor, object, key, hex, this._slot( object, slot ) );

	}

	setMaterialValue( object, key, value, slot = - 1 ) {

		return new SetMaterialValueCommand( this.editor, object, key, value, this._slot( object, slot ) );

	}

	setMaterial( object, material, slot = - 1 ) {

		return new SetMaterialCommand( this.editor, object, material, this._slot( object, slot ) );

	}

	addObject( object ) { return new AddObjectCommand( this.editor, object ); }
	removeObject( object ) { return new RemoveObjectCommand( this.editor, object ); }

	// ── Execution + history (delegated to the editor) ─────────────────────────

	multi( commands ) { return new MultiCmdsCommand( this.editor, commands ); }

	execute( command ) { this.editor.execute( command ); }

	undo() { this.editor.undo(); }

	redo() { this.editor.redo(); }

	// ── Change notification (fire the editor's signals) ───────────────────────

	notify( kind /*, payload */ ) {

		const s = this.editor.signals;
		if ( ! s ) return;

		switch ( kind ) {

			case 'autoLabel':
			case 'classChanged':
			case 'nameChanged':
				s.sceneGraphChanged?.dispatch();
				break;
			default:
				// Ops route through editor.execute(), which already dispatches the
				// right per-command signals; this is only for out-of-band changes.
				s.sceneGraphChanged?.dispatch();

		}

	}

	// The library passes slot 0 by default; Strata's single-material path uses -1.
	// Translate 0 → -1 for non-array materials so recolor matches editOps exactly.
	_slot( object, slot ) {

		if ( slot === 0 && object && ! Array.isArray( object.material ) ) return - 1;
		return slot;

	}

}
