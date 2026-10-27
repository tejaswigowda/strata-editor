// ── sceneLint.js ───────────────────────────────────────────────────────────────
// The labelling gate. A scene is ADDRESSABLE only if every object has a name an author chose
// and at least one class an author chose; otherwise $S('#id') and $S('.class') cannot reach it,
// an AI edit cannot target it and a tutorial cannot cite it.
//
// lintScene(root, opts)       → [{ object, path, reason }]   (pure; no three.js import)
// assertLabelled(root)        → throws one Error listing the first violations
// A scene opts in with scene.userData.requireLabels = true; commitSceneToRepo() then refuses to
// upload it while it has any violation. Scenes that have not opted in (imported glTF, mocap)
// are never blocked.
//
// What counts as a violation:
//   name    empty, '?', or a default (Mesh, Object3D, Group, Box, Sphere, Mesh_3, …)
//   unique  two objects with the same name (ids are matched without regard to case)
//   class   no author class in userData.customClasses (the field SetClassCommand and addClass write)
// Exempt: the scene root and engine-made helpers whose name starts with '__' (text shadows,
// edge outlines), which the author never addresses.

import { toClassSet } from './classDerive.js';

const DEFAULT_NAME = /^(\?+|object3d|object|mesh|node|group|primitive|untitled|instance|empty|geometry|box|sphere|cylinder|cone|plane|torus|circle|capsule|ring|dodecahedron|icosahedron|octahedron|tetrahedron|lathe|sprite|line|points)([\s_\-.]+\d+)?$/i;   // a bare type name, or one with a separated number (Box 2, Mesh_3)

export function isDefaultName( name ) {

	const n = String( name == null ? '' : name ).trim();
	return n === '' || DEFAULT_NAME.test( n );

}

export function hasAuthorClass( object ) {

	return toClassSet( object.userData && object.userData.customClasses ).size > 0;

}

function isInternal( object ) {

	return typeof object.name === 'string' && object.name.startsWith( '__' );

}

export function lintScene( root, { requireClass = true } = {} ) {

	const violations = [];
	const seen = new Map();

	const walk = ( object, path ) => {

		if ( isInternal( object ) ) return;
		const here = object === root ? '' : path + '/' + ( object.name || '(unnamed ' + ( object.type || 'Object3D' ) + ')' );

		if ( object !== root ) {

			if ( isDefaultName( object.name ) ) violations.push( { object, path: here, reason: 'no author name' } );
			else {

				const key = object.name.trim().toLowerCase();
				if ( seen.has( key ) ) violations.push( { object, path: here, reason: 'duplicate name (also ' + seen.get( key ) + ')' } );
				else seen.set( key, here );

			}

			if ( requireClass && ! hasAuthorClass( object ) ) violations.push( { object, path: here, reason: 'no class' } );

		}

		for ( const child of object.children || [] ) walk( child, here );

	};

	walk( root, '' );
	return violations;

}

export function formatViolations( violations, limit = 12 ) {

	const lines = violations.slice( 0, limit ).map( v => '  ' + v.path + ' — ' + v.reason );
	if ( violations.length > limit ) lines.push( '  … and ' + ( violations.length - limit ) + ' more' );
	return lines.join( '\n' );

}

export function assertLabelled( root, opts ) {

	const violations = lintScene( root, opts );
	if ( violations.length === 0 ) return;
	const unnamed = violations.filter( v => v.reason === 'no author name' ).length;
	const dup = violations.filter( v => v.reason.startsWith( 'duplicate' ) ).length;
	const noClass = violations.filter( v => v.reason === 'no class' ).length;
	throw new Error( 'Scene is not addressable: ' + unnamed + ' unnamed, ' + dup + ' duplicate, ' + noClass + ' without a class. Name and class every object (or merge decorative parts into one named mesh).\n' + formatViolations( violations ) );

}
