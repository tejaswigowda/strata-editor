// ── sceneEqual.js ─────────────────────────────────────────────────────────────
// Semantic equality checker for round-trip testing.
//
// Compares two three.js scene/object JSON outputs for structural equivalence:
//   - Same geometry types and parameters (within float epsilon)
//   - Same transforms (within float epsilon)
//   - Same material properties (within float epsilon)
//   - Same hierarchy (type + child count)
//
// Does NOT require UUIDs to match — they differ between separate serialize calls.
//
// Usage:
//   import { sceneEqual, objectEqual } from './scene/sceneEqual.js';
//   const result = sceneEqual(jsonA, jsonB, 1e-4);
//   if (!result.equal) console.log(result.differences);

// ── Helpers ───────────────────────────────────────────────────────────────────

function approxEq( a, b, eps ) {

	if ( typeof a !== 'number' || typeof b !== 'number' ) return a === b;
	return Math.abs( a - b ) <= eps;

}

function floatArrayEq( a, b, eps ) {

	if ( ! Array.isArray( a ) || ! Array.isArray( b ) ) return a === b;
	if ( a.length !== b.length ) return false;
	return a.every( ( v, i ) => approxEq( v, b[ i ], eps ) );

}

// ── Geometry comparison ───────────────────────────────────────────────────────

function compareGeometry( ga, gb, eps, path ) {

	const diffs = [];

	if ( ga.type !== gb.type ) {

		diffs.push( `${path}.geometry.type: "${ga.type}" !== "${gb.type}"` );
		return diffs;  // can't compare params if types differ

	}

	const pa = ga.parameters ?? {};
	const pb = gb.parameters ?? {};
	const keys = new Set( [ ...Object.keys( pa ), ...Object.keys( pb ) ] );

	for ( const k of keys ) {

		const va = pa[ k ];
		const vb = pb[ k ];

		if ( Array.isArray( va ) ) {

			if ( ! floatArrayEq( va, vb, eps ) ) {

				diffs.push( `${path}.geometry.parameters.${k}: ${JSON.stringify(va)} !== ${JSON.stringify(vb)}` );

			}

		} else if ( ! approxEq( va, vb, eps ) ) {

			diffs.push( `${path}.geometry.parameters.${k}: ${va} !== ${vb}` );

		}

	}

	return diffs;

}

// ── Material comparison ───────────────────────────────────────────────────────

function compareMaterial( ma, mb, eps, path ) {

	const diffs = [];

	if ( ma.type !== mb.type ) {

		diffs.push( `${path}.material.type: "${ma.type}" !== "${mb.type}"` );
		return diffs;

	}

	// Compare color (stored as integer)
	if ( 'color' in ma || 'color' in mb ) {

		if ( ! approxEq( ma.color ?? 0xffffff, mb.color ?? 0xffffff, 0 ) ) {

			diffs.push( `${path}.material.color: 0x${(ma.color??0xffffff).toString(16)} !== 0x${(mb.color??0xffffff).toString(16)}` );

		}

	}

	// Compare numeric props
	const numericProps = [ 'roughness', 'metalness', 'opacity', 'shininess', 'emissiveIntensity' ];

	for ( const prop of numericProps ) {

		if ( ! approxEq( ma[ prop ] ?? null, mb[ prop ] ?? null, eps ) ) {

			diffs.push( `${path}.material.${prop}: ${ma[prop]} !== ${mb[prop]}` );

		}

	}

	// Boolean props
	for ( const prop of [ 'wireframe', 'transparent' ] ) {

		if ( ( ma[ prop ] ?? false ) !== ( mb[ prop ] ?? false ) ) {

			diffs.push( `${path}.material.${prop}: ${ma[prop]} !== ${mb[prop]}` );

		}

	}

	return diffs;

}

// ── Transform comparison (from matrix) ───────────────────────────────────────

function decomposeMatrixSimple( matrix16 ) {

	const THREE = window.THREE;
	const m    = new THREE.Matrix4().fromArray( matrix16 );
	const pos  = new THREE.Vector3();
	const quat = new THREE.Quaternion();
	const scl  = new THREE.Vector3();
	m.decompose( pos, quat, scl );
	const euler = new THREE.Euler().setFromQuaternion( quat, 'XYZ' );

	return {
		position: [ pos.x,   pos.y,   pos.z   ],
		rotation: [ euler.x, euler.y, euler.z ],
		scale:    [ scl.x,   scl.y,   scl.z   ],
	};

}

function compareTransform( objA, objB, eps, path ) {

	const diffs = [];

	if ( ! objA.matrix && ! objB.matrix ) return diffs;

	const matA = objA.matrix ?? [ 1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1 ];
	const matB = objB.matrix ?? [ 1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1 ];

	const ta = decomposeMatrixSimple( matA );
	const tb = decomposeMatrixSimple( matB );

	if ( ! floatArrayEq( ta.position, tb.position, eps ) ) {

		diffs.push( `${path}.position: [${ta.position.join(',')}] !== [${tb.position.join(',')}]` );

	}

	if ( ! floatArrayEq( ta.rotation, tb.rotation, eps ) ) {

		diffs.push( `${path}.rotation: [${ta.rotation.join(',')}] !== [${tb.rotation.join(',')}]` );

	}

	if ( ! floatArrayEq( ta.scale, tb.scale, eps ) ) {

		diffs.push( `${path}.scale: [${ta.scale.join(',')}] !== [${tb.scale.join(',')}]` );

	}

	return diffs;

}

// ── Node comparison (recursive) ───────────────────────────────────────────────

function compareNode( nodeA, nodeB, geomMapA, geomMapB, matMapA, matMapB, eps, path ) {

	const diffs = [];

	if ( nodeA.type !== nodeB.type ) {

		diffs.push( `${path}.type: "${nodeA.type}" !== "${nodeB.type}"` );

	}

	// Name (optional — not always preserved by all paths)
	if ( nodeA.name && nodeB.name && nodeA.name !== nodeB.name ) {

		diffs.push( `${path}.name: "${nodeA.name}" !== "${nodeB.name}"` );

	}

	// Transform
	diffs.push( ...compareTransform( nodeA, nodeB, eps, path ) );

	// Geometry
	if ( nodeA.geometry || nodeB.geometry ) {

		const ga = geomMapA.get( nodeA.geometry );
		const gb = geomMapB.get( nodeB.geometry );

		if ( ga && gb ) {

			diffs.push( ...compareGeometry( ga, gb, eps, path ) );

		} else if ( ga || gb ) {

			diffs.push( `${path}.geometry: one side missing` );

		}

	}

	// Material
	if ( nodeA.material || nodeB.material ) {

		const ma = matMapA.get( nodeA.material );
		const mb = matMapB.get( nodeB.material );

		if ( ma && mb ) {

			diffs.push( ...compareMaterial( ma, mb, eps, path ) );

		} else if ( ma || mb ) {

			diffs.push( `${path}.material: one side missing` );

		}

	}

	// Children (by index — requires same hierarchy)
	const childrenA = nodeA.children ?? [];
	const childrenB = nodeB.children ?? [];

	if ( childrenA.length !== childrenB.length ) {

		diffs.push( `${path}.children.length: ${childrenA.length} !== ${childrenB.length}` );

	}

	const limit = Math.min( childrenA.length, childrenB.length );

	for ( let i = 0; i < limit; i++ ) {

		diffs.push( ...compareNode(
			childrenA[ i ], childrenB[ i ],
			geomMapA, geomMapB, matMapA, matMapB,
			eps, `${path}.children[${i}]`
		) );

	}

	return diffs;

}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compare two three.js scene/object JSON outputs for semantic equality.
 *
 * @param  {object} jsonA     first JSON (e.g. from scene.toJSON())
 * @param  {object} jsonB     second JSON
 * @param  {number} [epsilon] float tolerance, default 1e-4
 * @returns {{ equal: boolean, differences: string[] }}
 */
export function sceneEqual( jsonA, jsonB, epsilon = 1e-4 ) {

	const geomMapA = new Map( ( jsonA.geometries ?? [] ).map( g => [ g.uuid, g ] ) );
	const geomMapB = new Map( ( jsonB.geometries ?? [] ).map( g => [ g.uuid, g ] ) );
	const matMapA  = new Map( ( jsonA.materials  ?? [] ).map( m => [ m.uuid, m ] ) );
	const matMapB  = new Map( ( jsonB.materials  ?? [] ).map( m => [ m.uuid, m ] ) );

	const diffs = compareNode(
		jsonA.object, jsonB.object,
		geomMapA, geomMapB, matMapA, matMapB,
		epsilon, 'root'
	);

	return { equal: diffs.length === 0, differences: diffs };

}

/**
 * Convenience: compare two live Object3D / Scene instances.
 *
 * @param  {THREE.Object3D} objA
 * @param  {THREE.Object3D} objB
 * @param  {number}  [epsilon]
 * @returns {{ equal: boolean, differences: string[] }}
 */
export function objectEqual( objA, objB, epsilon = 1e-4 ) {

	return sceneEqual( objA.toJSON(), objB.toJSON(), epsilon );

}
