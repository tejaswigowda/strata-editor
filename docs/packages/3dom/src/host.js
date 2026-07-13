// ── host.js — the dependency-cut injection point ──────────────────────────────
//
// $S/3DOM must run over a bare THREE.Scene with NO editor present, AND be wirable
// into a host application (Strata) so ops flow through the host's own undo/redo and
// refresh its UI. The seam between those two worlds is the **Host**.
//
// A Host is a command factory + an executor + a change notifier + the scene:
//
//   host.scene                      the root Object3D every op resolves against
//   host.execute(command)           run a command, record it for undo
//   host.undo() / redo()            walk the history
//   host.multi(commands)            batch commands into ONE undo unit
//   host.notify(kind, payload)      fire a change event (host refreshes its UI)
//   host.<factory>(...)             build a command (see COMMAND FACTORIES below)
//
// The ops layer NEVER imports a concrete command class or an editor. It only calls
// host factories. That is the whole cut: swap the Host, keep the ops.
//
//   • DefaultHost (this file): library-internal commands over plain Object3D, its
//     own undo stack, an onChange callback. Zero app dependencies — the standalone
//     path (`$S(scene)('.wheel').recolor('#f00')` in a bare three.js page).
//   • A host application supplies its OWN Host (e.g. Strata maps each factory to its
//     real command classes + editor.execute + signals) via createS(scene, { host }).

import { THREE } from './three.js';

// ── Command factories (the Host contract) ─────────────────────────────────────
// Every factory returns a command: { name, execute(), undo() }. A Host may return
// its OWN richer command instead, as long as it honors execute()/undo().

function firstMaterial( obj, slot = 0 ) {

	if ( ! obj || ! obj.material ) return null;
	return Array.isArray( obj.material ) ? obj.material[ slot ] : obj.material;

}

// The default command set: minimal, reversible mutations over plain three.js
// objects. No signals, no serialization — just correct undo.
export const defaultCommands = {

	setPosition( obj, vec ) {

		const from = obj.position.clone();
		const to = vec.clone ? vec.clone() : new THREE.Vector3( vec.x, vec.y, vec.z );
		return { name: 'setPosition', execute: () => obj.position.copy( to ), undo: () => obj.position.copy( from ) };

	},

	setRotation( obj, euler ) {

		const from = obj.rotation.clone();
		const to = euler.clone ? euler.clone() : new THREE.Euler( euler.x, euler.y, euler.z, euler.order );
		return { name: 'setRotation', execute: () => obj.rotation.copy( to ), undo: () => obj.rotation.copy( from ) };

	},

	setScale( obj, vec ) {

		const from = obj.scale.clone();
		const to = vec.clone ? vec.clone() : new THREE.Vector3( vec.x, vec.y, vec.z );
		return { name: 'setScale', execute: () => obj.scale.copy( to ), undo: () => obj.scale.copy( from ) };

	},

	setValue( obj, key, value ) {

		const from = obj[ key ];
		return { name: 'setValue:' + key, execute: () => { obj[ key ] = value; }, undo: () => { obj[ key ] = from; } };

	},

	setColor( obj, key, hex ) {

		const target = obj[ key ];
		const from = target && target.getHex ? target.getHex() : null;
		return {
			name: 'setColor:' + key,
			execute: () => { if ( obj[ key ] && obj[ key ].setHex ) obj[ key ].setHex( hex ); },
			undo: () => { if ( from !== null && obj[ key ] && obj[ key ].setHex ) obj[ key ].setHex( from ); },
		};

	},

	setMaterialColor( obj, key, hex, slot = 0 ) {

		const mat = firstMaterial( obj, slot );
		const from = mat && mat[ key ] && mat[ key ].getHex ? mat[ key ].getHex() : null;
		return {
			name: 'setMaterialColor:' + key,
			execute: () => { if ( mat && mat[ key ] && mat[ key ].setHex ) { mat[ key ].setHex( hex ); mat.needsUpdate = true; } },
			undo: () => { if ( from !== null && mat && mat[ key ] && mat[ key ].setHex ) { mat[ key ].setHex( from ); mat.needsUpdate = true; } },
		};

	},

	setMaterialValue( obj, key, value, slot = 0 ) {

		const mat = firstMaterial( obj, slot );
		const from = mat ? mat[ key ] : undefined;
		return {
			name: 'setMaterialValue:' + key,
			execute: () => { if ( mat ) { mat[ key ] = value; mat.needsUpdate = true; } },
			undo: () => { if ( mat ) { mat[ key ] = from; mat.needsUpdate = true; } },
		};

	},

	setMaterial( obj, material ) {

		const from = obj.material;
		return { name: 'setMaterial', execute: () => { obj.material = material; }, undo: () => { obj.material = from; } };

	},

	addObject( obj, parent ) {

		return {
			name: 'addObject',
			execute: () => { ( parent || obj.parent ).add( obj ); },
			undo: () => { ( parent || obj.parent ).remove( obj ); },
		};

	},

	removeObject( obj ) {

		const parent = obj.parent;
		const index = parent ? parent.children.indexOf( obj ) : -1;
		return {
			name: 'removeObject',
			execute: () => { if ( obj.parent ) obj.parent.remove( obj ); },
			undo: () => {

				if ( ! parent ) return;
				parent.add( obj );
				// restore sibling order so indices/traversal stay stable
				if ( index >= 0 && index < parent.children.length - 1 ) {

					parent.children.splice( parent.children.indexOf( obj ), 1 );
					parent.children.splice( index, 0, obj );

				}

			},
		};

	},

};

// ── DefaultHost ───────────────────────────────────────────────────────────────
// The standalone Host: default commands + a simple in-memory undo/redo stack + an
// onChange emitter. This is what a bare three.js page gets for free.

export class DefaultHost {

	/**
	 * @param {THREE.Object3D} scene  the root every selector resolves against
	 * @param {object} [opts]
	 * @param {(kind:string, payload?:any)=>void} [opts.onChange]  change callback
	 * @param {number} [opts.historyLimit]  max undo entries (default 200)
	 */
	constructor( scene, opts = {} ) {

		if ( ! scene || ! scene.traverse ) throw new Error( '3DOM: a THREE.Object3D scene root is required' );
		this.scene = scene;
		this._undo = [];
		this._redo = [];
		this._limit = opts.historyLimit || 200;
		this._onChange = typeof opts.onChange === 'function' ? opts.onChange : null;

	}

	// change notification -------------------------------------------------------
	notify( kind, payload ) { if ( this._onChange ) this._onChange( kind, payload ); }

	onChange( fn ) { this._onChange = fn; return this; }

	// command factories (delegate to the default command set) -------------------
	setPosition( ...a ) { return defaultCommands.setPosition( ...a ); }
	setRotation( ...a ) { return defaultCommands.setRotation( ...a ); }
	setScale( ...a ) { return defaultCommands.setScale( ...a ); }
	setValue( ...a ) { return defaultCommands.setValue( ...a ); }
	setColor( ...a ) { return defaultCommands.setColor( ...a ); }
	setMaterialColor( ...a ) { return defaultCommands.setMaterialColor( ...a ); }
	setMaterialValue( ...a ) { return defaultCommands.setMaterialValue( ...a ); }
	setMaterial( ...a ) { return defaultCommands.setMaterial( ...a ); }
	addObject( ...a ) { return defaultCommands.addObject( ...a ); }
	removeObject( ...a ) { return defaultCommands.removeObject( ...a ); }

	multi( commands ) {

		const cmds = commands.filter( Boolean );
		return {
			name: 'multi',
			execute: () => { for ( const c of cmds ) c.execute(); },
			undo: () => { for ( let i = cmds.length - 1; i >= 0; i -- ) cmds[ i ].undo(); },
		};

	}

	// execution / history -------------------------------------------------------
	execute( command ) {

		if ( ! command ) return;
		command.execute();
		this._undo.push( command );
		if ( this._undo.length > this._limit ) this._undo.shift();
		this._redo.length = 0;
		this.notify( 'execute', command );
		return command;

	}

	undo() {

		const cmd = this._undo.pop();
		if ( ! cmd ) return false;
		cmd.undo();
		this._redo.push( cmd );
		this.notify( 'undo', cmd );
		return true;

	}

	redo() {

		const cmd = this._redo.pop();
		if ( ! cmd ) return false;
		cmd.execute();
		this._undo.push( cmd );
		this.notify( 'redo', cmd );
		return true;

	}

	clearHistory() { this._undo.length = 0; this._redo.length = 0; }

	get historyLength() { return this._undo.length; }

}

/**
 * Coerce whatever the consumer passed into a Host. Accepts:
 *   • a THREE scene/Object3D  → wraps in a DefaultHost
 *   • an existing Host object  → used as-is (host application supplied its own)
 * @param {THREE.Object3D|object} sceneOrHost
 * @param {object} [opts]  forwarded to DefaultHost when a scene is passed
 * @returns {DefaultHost|object}
 */
export function resolveHost( sceneOrHost, opts = {} ) {

	if ( sceneOrHost && typeof sceneOrHost.execute === 'function' && sceneOrHost.scene ) {

		return sceneOrHost; // already a Host

	}

	return new DefaultHost( sceneOrHost, opts );

}
