// ── classDerive.js ─────────────────────────────────────────────────────────────
// Derive CSS-like classes from descriptors (deterministic, no model).
// Classes enable selector-based addressing of scene graph nodes.
//
// deriveClasses(node) → Set of class strings
//   Stored in node.userData.classes (serializable, git-diffable)
//   Re-derived from descriptors on import or on-demand.
//
// Class categories:
//   Spatial   (.front, .back, .left, .right, .top, .bottom, .center)
//   Color     (.red, .blue, .metallic, etc.)
//   Shape     (.elongated, .flat, .blocky, .thin)
//   Type      (.mesh, .group, .light, .camera, etc.)
//   Material  (.wheel, .grille, .glass, etc. — decoded semantic names)
//   Symmetry  (.pair-left, .pair-right, .pair-front, .pair-back)

/**
 * Normalize an arbitrary token (material name, semantic label) into a class
 * string: lowercase, spaces→hyphens, strip non-alphanumeric. ONE definition so
 * derivation and matching agree (a label "Front Wheel" and a selector
 * ".front-wheel" must reconcile).
 * @param {string} str
 * @returns {string}
 */
export function normalizeClassName( str ) {

	return String( str ).toLowerCase().trim()
		.replace( /\s+/g, '-' )       // spaces → hyphens
		.replace( /[^a-z0-9-]/g, '' ); // strip non-alphanumeric

}

/**
 * Coerce a stored class collection into a Set. Custom classes are persisted as a
 * plain Array in userData so they survive JSON / git / glTF round-trips; but a
 * Set that was JSON-serialized becomes `{}` and legacy scenes may hold either
 * form. This normalizes Set | Array | iterable | plain-object | nullish into a
 * Set so callers never hit "customClasses is not iterable".
 * @param {*} value
 * @returns {Set<string>}
 */
export function toClassSet( value ) {

	if ( value instanceof Set ) return value;
	if ( Array.isArray( value ) ) return new Set( value );
	if ( value && typeof value[ Symbol.iterator ] === 'function' ) return new Set( value );
	if ( value && typeof value === 'object' ) return new Set( Object.values( value ) );
	return new Set();

}

// Auto-generated / meaningless node names we never turn into a class. Imported
// glTF parts ("Object_12", "mesh_0") rely on descriptors and labels instead;
// turning their raw names into classes would flood the vocabulary with noise. A
// meaningful name ("Chair", "Chair 1") DOES become a ".chair" class so the model
// can group them with "$S('.chair')".
const AUTO_NAME_RE = /^(object|mesh|node|group|primitive|untitled|instance|empty|scene|geometry|buffergeometry|material|texture)[\s_\-.]*\d*$/i;

/**
 * Derive a "stem" class from a node's name: drop a trailing index so "Chair 1",
 * "Chair 2", "Chair 3" all share ".chair". Returns '' when the name is absent,
 * too short, or auto-generated.
 * @param {THREE.Object3D} node
 * @returns {string}
 */
export function nameStemClass( node ) {

	if ( ! node ) return '';
	const raw = node.name && String( node.name ).trim();
	if ( ! raw || raw.length < 2 ) return '';
	if ( AUTO_NAME_RE.test( raw ) ) return '';
	const stem = raw.replace( /[\s_.-]*\d+$/, '' ).trim() || raw; // strip trailing index
	return normalizeClassName( stem );

}

/**
 * Derive classes for a single node from its descriptors.
 * Returns a Set of class strings (e.g. ['front', 'left', 'red', 'mesh', 'wheel']).
 *
 * @param {THREE.Object3D} node   with userData.descriptors
 * @returns {Set<string>}
 */
export function deriveClasses( node ) {

	const classes = new Set();

	if ( ! node ) return classes;

	// Type classes — three.js type
	if ( node.isMesh ) classes.add( 'mesh' );
	if ( node.isLight ) classes.add( 'light' );
	if ( node.isCamera ) classes.add( 'camera' );
	if ( node.isGroup || ( ! node.isMesh && node.children ) ) classes.add( 'group' );
	if ( node.isPointLight ) classes.add( 'point-light' );
	if ( node.isDirectionalLight ) classes.add( 'directional-light' );
	if ( node.isSpotLight ) classes.add( 'spot-light' );
	if ( node.isHemisphereLight ) classes.add( 'hemisphere-light' );
	if ( node.isOrthographicCamera ) classes.add( 'orthographic-camera' );
	if ( node.isPerspectiveCamera ) classes.add( 'perspective-camera' );
	if ( node.isSkinnedMesh ) classes.add( 'skinned-mesh' );

	// Name-stem class — a meaningful object name becomes an addressable class so
	// "$S('.chair')" groups "Chair 1", "Chair 2", … These are generated or
	// hand-named parts that carry no descriptors; auto-generated names are skipped.
	const nameCls = nameStemClass( node );
	if ( nameCls ) classes.add( nameCls );

	// Descriptor-based classes (facts — deterministic, no guesses)
	const d = node.userData.descriptors;
	if ( ! d ) return classes;

	// Spatial: region relative to parent
	if ( d.region ) {

		const reg = d.region;
		if ( reg.x ) classes.add( reg.x );         // 'left' | 'right' | 'center'
		if ( reg.y ) classes.add( reg.y );         // 'top' | 'bottom' | 'center'
		if ( reg.z ) classes.add( reg.z );         // 'front' | 'back' | 'center'

	}

	// Shape
	if ( d.shape ) classes.add( d.shape );        // 'elongated' | 'flat' | 'blocky' | 'thin'

	// Color (base name)
	if ( d.color && d.color.base ) classes.add( d.color.base ); // 'red' | 'blue' | ...

	// Material names (decoded, semantic — high-value)
	if ( d.materials && Array.isArray( d.materials ) ) {

		for ( const matName of d.materials ) {

			// Normalize material name to lowercase class
			const cls = normalizeClassName( matName );
			if ( cls ) classes.add( cls );

		}

	}

	// Symmetry
	if ( d.pair ) {

		classes.add( 'paired' );
		if ( d.pair.side ) classes.add( 'pair-' + d.pair.side ); // 'pair-left' | 'pair-right' | ...

	}

	// Orientation (optional, may be null)
	if ( d.orientation ) classes.add( d.orientation ); // 'vertical' | 'horizontal'

	// Size rank
	if ( d.sizeRank ) classes.add( d.sizeRank );  // 'largest' | 'medium' | 'smallest'

	// Role (graph topology: 'leaf' | 'group') is deliberately NOT emitted as a class.
	// 'leaf' means "scene-graph leaf" (any childless mesh) — every mesh is one, so a
	// '.leaf' class matches an entire asset AND collides with the English word
	// "leaf/leaves" (a tree/plant's parts all resolve, recoloring the trunk too).
	// Both values are already covered by the type classes ('.mesh', '.group'); code
	// that needs topology reads node.userData.descriptors.role directly.

	return classes;

}

/**
 * Derive classes for all nodes in a subtree.
 * Writes to node.userData.classes (overwrites existing).
 * 
 * @param {THREE.Object3D} root
 */
export function deriveAllClasses( root ) {

	if ( ! root ) return;

	root.traverse( node => {

		node.userData.classes = deriveClasses( node );

		// Custom classes are user intent (not re-derivable) — normalize any loaded
		// representation to a persistable Array so it survives the next save.
		if ( node.userData.customClasses !== undefined ) {

			node.userData.customClasses = Array.from( toClassSet( node.userData.customClasses ) );

		}

	} );

}

/**
 * Check if a node has a given class.
 * @param {THREE.Object3D} node
 * @param {string} cls
 * @returns {boolean}
 */
export function hasClass( node, cls ) {

	if ( ! node || ! cls ) return false;
	// Auto-classes are re-derivable; if absent or deserialized to a non-Set (a
	// Set becomes `{}` through JSON), rebuild from descriptors rather than trust
	// the stored form.
	if ( ! ( node.userData.classes instanceof Set ) ) node.userData.classes = deriveClasses( node );

	// 1) Auto-derived classes (facts: spatial, shape, color, material-name, type).
	if ( node.userData.classes.has( cls ) ) return true;

	// 2) Custom (user/verified) classes added via addClass — the selector engine
	//    matches against hasClass, so these MUST be consulted here too.
	if ( node.userData.customClasses && toClassSet( node.userData.customClasses ).has( cls ) ) return true;

	// 3) Semantic label from the import labeling pass (task 4) is stored in
	//    userData.label only. A label shared by N symmetric parts (e.g. "wheel"
	//    on 4 wheels) acts like a class — so ".wheel" must resolve them. Compare
	//    normalized so "Front Wheel"→".front-wheel" reconciles.
	if ( node.userData.label && normalizeClassName( node.userData.label ) === normalizeClassName( cls ) ) return true;

	return false;

}

/**
 * Add a custom (semantic) class to a node.
 * These are user-facing classes that don't auto-derive (e.g., .wheel, #dump-bed).
 * Stored separately so they persist across descriptor updates.
 * 
 * @param {THREE.Object3D} node
 * @param {string} cls
 */
export function addClass( node, cls ) {

	if ( ! node || ! cls ) return;
	const set = toClassSet( node.userData.customClasses );
	set.add( cls );
	// Persist as an Array so it survives JSON / git / glTF round-trips.
	node.userData.customClasses = Array.from( set );

}

/**
 * Remove a custom class.
 * @param {THREE.Object3D} node
 * @param {string} cls
 */
export function removeClass( node, cls ) {

	if ( ! node || ! cls ) return;
	if ( node.userData.customClasses === undefined ) return;
	const set = toClassSet( node.userData.customClasses );
	set.delete( cls );
	node.userData.customClasses = Array.from( set );

}

/**
 * Get all classes (auto-derived + custom) for a node.
 * @param {THREE.Object3D} node
 * @returns {Set<string>}
 */
export function getAllClasses( node ) {

	const all = new Set( deriveClasses( node ) );
	if ( node.userData.customClasses ) {

		for ( const cls of toClassSet( node.userData.customClasses ) ) all.add( cls );

	}
	return all;

}
