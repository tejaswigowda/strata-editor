// ── geometryParams.js ─────────────────────────────────────────────────────────
// Maps three.js geometry type names to their ordered constructor-argument
// descriptors.  Used by codegen.js to emit constructor calls like:
//   new THREE.BoxGeometry(width, height, depth, widthSegs, heightSegs, depthSegs)
//
// Design:
//   - Primary source: geometry.parameters (set by three.js constructors).
//     We use .parameters directly when available, making the table serve as a
//     fallback / default-pruning guide.
//   - PARAM_ORDER[type] gives the ordered list of parameter names.
//   - PARAM_DEFAULTS[type] gives default values so trailing defaults are omitted.
//   - deriveArgs(geometry) is the main export: returns an array of arg values
//     for the geometry's constructor call.

// ── Ordered parameter names per geometry type ────────────────────────────────

export const PARAM_ORDER = {

	BoxGeometry:          [ 'width', 'height', 'depth', 'widthSegments', 'heightSegments', 'depthSegments' ],
	SphereGeometry:       [ 'radius', 'widthSegments', 'heightSegments', 'phiStart', 'phiLength', 'thetaStart', 'thetaLength' ],
	CylinderGeometry:     [ 'radiusTop', 'radiusBottom', 'height', 'radialSegments', 'heightSegments', 'openEnded', 'thetaStart', 'thetaLength' ],
	ConeGeometry:         [ 'radius', 'height', 'radialSegments', 'heightSegments', 'openEnded', 'thetaStart', 'thetaLength' ],
	PlaneGeometry:        [ 'width', 'height', 'widthSegments', 'heightSegments' ],
	CircleGeometry:       [ 'radius', 'segments', 'thetaStart', 'thetaLength' ],
	TorusGeometry:        [ 'radius', 'tube', 'radialSegments', 'tubularSegments', 'arc' ],
	TorusKnotGeometry:    [ 'radius', 'tube', 'tubularSegments', 'radialSegments', 'p', 'q' ],
	RingGeometry:         [ 'innerRadius', 'outerRadius', 'thetaSegments', 'phiSegments', 'thetaStart', 'thetaLength' ],
	DodecahedronGeometry: [ 'radius', 'detail' ],
	IcosahedronGeometry:  [ 'radius', 'detail' ],
	OctahedronGeometry:   [ 'radius', 'detail' ],
	TetrahedronGeometry:  [ 'radius', 'detail' ],
	CapsuleGeometry:      [ 'radius', 'length', 'capSegments', 'radialSegments' ],
	TubeGeometry:         [],  // requires a Curve — not reconstructable from params alone
	LatheGeometry:        [],  // requires points array — handled as lossy
	ExtrudeGeometry:      [],  // requires shape — handled as lossy
	ShapeGeometry:        [],  // requires shape — handled as lossy
	EdgesGeometry:        [],  // wraps another geometry — handled as lossy
	WireframeGeometry:    [],  // wraps another geometry — handled as lossy

};

// ── Default constructor argument values ─────────────────────────────────────

export const PARAM_DEFAULTS = {

	BoxGeometry:          { width: 1, height: 1, depth: 1, widthSegments: 1, heightSegments: 1, depthSegments: 1 },
	SphereGeometry:       { radius: 1, widthSegments: 32, heightSegments: 16, phiStart: 0, phiLength: Math.PI * 2, thetaStart: 0, thetaLength: Math.PI },
	CylinderGeometry:     { radiusTop: 1, radiusBottom: 1, height: 1, radialSegments: 32, heightSegments: 1, openEnded: false, thetaStart: 0, thetaLength: Math.PI * 2 },
	ConeGeometry:         { radius: 1, height: 1, radialSegments: 32, heightSegments: 1, openEnded: false, thetaStart: 0, thetaLength: Math.PI * 2 },
	PlaneGeometry:        { width: 1, height: 1, widthSegments: 1, heightSegments: 1 },
	CircleGeometry:       { radius: 1, segments: 32, thetaStart: 0, thetaLength: Math.PI * 2 },
	TorusGeometry:        { radius: 1, tube: 0.4, radialSegments: 12, tubularSegments: 48, arc: Math.PI * 2 },
	TorusKnotGeometry:    { radius: 1, tube: 0.4, tubularSegments: 64, radialSegments: 8, p: 2, q: 3 },
	RingGeometry:         { innerRadius: 0.5, outerRadius: 1, thetaSegments: 32, phiSegments: 1, thetaStart: 0, thetaLength: Math.PI * 2 },
	DodecahedronGeometry: { radius: 1, detail: 0 },
	IcosahedronGeometry:  { radius: 1, detail: 0 },
	OctahedronGeometry:   { radius: 1, detail: 0 },
	TetrahedronGeometry:  { radius: 1, detail: 0 },
	CapsuleGeometry:      { radius: 1, length: 1, capSegments: 4, radialSegments: 8 },

};

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Derive the constructor argument list for a geometry, ready for codegen.
 * Returns null if the geometry type is known-lossy (no valid param reconstruction).
 *
 * @param  {object} geomJSON  geometry record from scene.toJSON().geometries[]
 *                            OR a live THREE.BufferGeometry
 * @returns {{ args: any[], lossy: false } | { lossy: true, reason: string }}
 */
export function deriveArgs( geomJSON ) {

	// Accept both live geometry objects and JSON records
	const type   = geomJSON.type;
	const params = geomJSON.parameters ?? {};  // live geometry exposes .parameters

	const order    = PARAM_ORDER[ type ];
	const defaults = PARAM_DEFAULTS[ type ];

	// Unknown type — must check if it's a custom BufferGeometry
	if ( order === undefined ) {

		return { lossy: true, reason: `Unknown geometry type: ${type}` };

	}

	// Known-lossy types (empty param order means no constructor reconstruction)
	if ( order.length === 0 ) {

		return { lossy: true, reason: `${type} requires runtime data (curves/shapes) — not reconstructable from params` };

	}

	if ( ! defaults ) {

		return { lossy: true, reason: `No default table for ${type}` };

	}

	// Build args array, pruning trailing defaults
	const args = order.map( key => {

		const val = params[ key ];
		return val !== undefined ? val : defaults[ key ];

	} );

	// Prune trailing args equal to defaults (right-to-left)
	while (
		args.length > 1 &&
		args[ args.length - 1 ] === defaults[ order[ args.length - 1 ] ]
	) {

		args.pop();

	}

	return { args, lossy: false };

}

/**
 * Returns true if the geometry type is reconstructable via a constructor call.
 */
export function isReconstructable( type ) {

	const order = PARAM_ORDER[ type ];
	return order !== undefined && order.length > 0 && PARAM_DEFAULTS[ type ] !== undefined;

}
