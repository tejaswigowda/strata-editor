// ── chain.js — the $S chainable set (jQuery for 3D) ───────────────────────────
//
// $S(selector) returns a ChainableSet: a live handle on the matched nodes with a
// fluent, chainable API. Mutations route through the bound Host (undoable); reads
// return plain values; traversal returns new sets. Every mutating call returns the
// set, so ops chain: $S('.wheel').recolor('#111').scale(1.2).rotate('y', 90).

import * as selectorEngine from './selectorEngine.js';
import { addClass, removeClass, getAllClasses } from './classDerive.js';
import * as ops from './ops.js';

export class ChainableSet {

	/**
	 * @param {object} host          the bound Host (scene + command factories)
	 * @param {string|Array} target  a selector string, or an explicit node array
	 */
	constructor( host, target ) {

		this._host = host;
		this._target = target; // kept as-is so selector sets stay live
		this._nodes = Array.isArray( target ) ? target.slice() : selectorEngine.query( host.scene, target );

	}

	// ── Read layer (terminal values) ─────────────────────────────────────────
	get nodes() { return this._nodes.slice(); }
	get length() { return this._nodes.length; }
	get count() { return this._nodes.length; }
	get exists() { return this._nodes.length > 0; }
	get names() { return this._nodes.map( n => n.name || '' ); }
	get first() { return new ChainableSet( this._host, this._nodes.slice( 0, 1 ) ); }
	get last() { return new ChainableSet( this._host, this._nodes.slice( -1 ) ); }
	classes() { const s = new Set(); for ( const n of this._nodes ) for ( const c of getAllClasses( n ) ) s.add( c ); return [ ...s ]; }
	each( fn ) { this._nodes.forEach( fn ); return this; }
	toArray() { return this._nodes.slice(); }

	// ── Traversal (return new sets) ──────────────────────────────────────────
	not( selector ) {

		const excluded = new Set( selectorEngine.query( this._host.scene, selector ) );
		return new ChainableSet( this._host, this._nodes.filter( n => ! excluded.has( n ) ) );

	}

	parent() {

		const seen = new Set();
		const parents = [];
		for ( const n of this._nodes ) if ( n.parent && ! seen.has( n.parent ) ) { seen.add( n.parent ); parents.push( n.parent ); }
		return new ChainableSet( this._host, parents );

	}

	children() {

		const out = [];
		for ( const n of this._nodes ) for ( const c of n.children ) out.push( c );
		return new ChainableSet( this._host, out );

	}

	filter( pred ) { return new ChainableSet( this._host, this._nodes.filter( pred ) ); }

	// ── Internal: run an op-JSON, keep the chain ─────────────────────────────
	op( json ) { ops.dispatchOp( this._host, { ...json, selector: this._nodes } ); return this; }
	ops( list ) { for ( const j of list ) this.op( j ); return this; }

	// ── Mutating ops (chainable) ─────────────────────────────────────────────
	recolor( color ) { ops.recolorOp( this._host, this._nodes, color ); return this; }
	scale( factor, axis = null ) { ops.scaleOp( this._host, this._nodes, factor, axis ); return this; }
	move( x = 0, y = 0, z = 0 ) { ops.moveOp( this._host, this._nodes, x, y, z ); return this; }
	rotate( axis, degrees ) { ops.rotateOp( this._host, this._nodes, axis, degrees ); return this; }
	delete() { ops.deleteOp( this._host, this._nodes ); return this; }
	duplicate( x, y, z ) { ops.duplicateOp( this._host, this._nodes, x, y, z ); return this; }
	setMaterial( props ) { ops.setMaterialOp( this._host, this._nodes, props ); return this; }
	setOpacity( v ) { ops.setOpacityOp( this._host, this._nodes, v ); return this; }
	setVisible( v ) { ops.setVisibleOp( this._host, this._nodes, v ); return this; }
	wireframe( on = true ) { ops.wireframeOp( this._host, this._nodes, on ); return this; }

	// bulk property setters (three.js-named where they exist)
	castShadow( v = true ) { ops.setObjectPropOp( this._host, this._nodes, 'castShadow', Boolean( v ) ); return this; }
	receiveShadow( v = true ) { ops.setObjectPropOp( this._host, this._nodes, 'receiveShadow', Boolean( v ) ); return this; }
	renderOrder( v ) { ops.setObjectPropOp( this._host, this._nodes, 'renderOrder', v ); return this; }
	metalness( v ) { ops.setMaterialPropOp( this._host, this._nodes, 'metalness', v ); return this; }
	roughness( v ) { ops.setMaterialPropOp( this._host, this._nodes, 'roughness', v ); return this; }

	// ── Class / label mutation ───────────────────────────────────────────────
	addClass( cls ) { for ( const n of this._nodes ) addClass( n, cls ); this._host.notify( 'classChanged' ); return this; }
	removeClass( cls ) { for ( const n of this._nodes ) removeClass( n, cls ); this._host.notify( 'classChanged' ); return this; }
	editID( name ) { for ( const n of this._nodes ) n.name = name; this._host.notify( 'nameChanged' ); return this; }

}
