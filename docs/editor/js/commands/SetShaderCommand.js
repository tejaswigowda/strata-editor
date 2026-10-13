import { Command } from '../Command.js';

const copyGroups = g => g.map( x => ( { start: x.start, count: x.count, materialIndex: x.materialIndex } ) );

function snapshot( editor, roots ) {

	const meshes = [];
	const geometries = new Set();
	for ( const r of roots ) r.traverse( o => {

		if ( ! o.isMesh || ! o.material ) return;
		meshes.push( { mesh: o, material: Array.isArray( o.material ) ? [ ...o.material ] : o.material } );
		geometries.add( o.geometry );

	} );

	return {
		meshes,
		groups: [ ...geometries ].map( g => ( { geometry: g, groups: copyGroups( g.groups ) } ) ),
		looks: roots.map( r => ( r.userData && r.userData.look ) || null ),
		children: new Set( editor.scene.children ),
	};

}

/**
 * Apply a shader (see shaders/ShaderLibrary.js) to the meshes under `roots` as ONE undoable step.
 * `run` does the work (a closure over applyShader); it runs once, then undo / redo swap the
 * recorded before / after materials, draw groups and any lights it added. Like CustomizeCommand it
 * is not restorable from a saved history: the materials themselves ride in the scene.
 */
class SetShaderCommand extends Command {

	constructor( editor, roots = [], run = null, name = 'Set Shader' ) {

		super( editor );

		this.type = 'SetShaderCommand';
		this.name = name;
		this.roots = roots;
		this.run = run;
		this.before = null;
		this.after = null;
		this.addedLights = [];
		this.result = null;

	}

	execute() {

		if ( this.after ) {

			this.restore( this.after );
			this.addedLights.forEach( l => this.editor.scene.add( l ) );
			this.refresh();
			return;

		}

		this.before = snapshot( this.editor, this.roots );
		this.result = this.run();
		this.after = snapshot( this.editor, this.roots );
		this.addedLights = this.editor.scene.children.filter( c => ! this.before.children.has( c ) );
		this.refresh();

	}

	undo() {

		if ( ! this.before ) return;
		this.addedLights.forEach( l => l.removeFromParent() );
		this.restore( this.before );
		this.refresh();

	}

	restore( snap ) {

		for ( const { mesh, material } of snap.meshes ) mesh.material = Array.isArray( material ) ? [ ...material ] : material;
		for ( const { geometry, groups } of snap.groups ) {

			geometry.clearGroups();
			for ( const g of groups ) geometry.addGroup( g.start, g.count, g.materialIndex );

		}
		this.roots.forEach( ( r, i ) => {

			r.userData = r.userData || {};
			if ( snap.looks[ i ] ) r.userData.look = snap.looks[ i ]; else delete r.userData.look;

		} );

	}

	refresh() {

		const { signals, selected } = this.editor;
		signals.sceneGraphChanged.dispatch();
		this.roots.forEach( r => signals.objectChanged.dispatch( r ) );
		if ( selected && selected.isMesh ) signals.materialChanged.dispatch( selected, 0 );

	}

	fromJSON( json ) {

		super.fromJSON( json );
		this.before = this.after = null;
		this.roots = [];

	}

}

export { SetShaderCommand };
