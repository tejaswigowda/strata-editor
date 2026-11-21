import { Matrix4 } from '../../../build/three.core.js';
import { MIN_SCALE, checkQuaternion, refuse } from './opRefusals.js';

const axes = [ 'x', 'y', 'z' ];

export function validateSceneJSON( json, op = 'load' ) {

	const issues = [];
	const add = ( code, argument, received, nearest, requirement, object ) => issues.push( refuse( code, op, argument, received, nearest, requirement, object ) );
	const matrix = new Matrix4();
	const seen = new Set();
	const names = new Map();
	const inspect = ( data, field ) => {

		if ( ! data?.object ) {

			add( 'SCENE_INVALID', `${ field }.object`, data?.object, null, 'requires an object', field );
			return;

		}
		const refs = Object.fromEntries( [ 'geometry', 'material', 'animations' ].map( key => {

			const table = { geometry: 'geometries', material: 'materials', animations: 'animations' }[ key ];
			return [ key, new Set( ( data[ table ] || [] ).map( entry => entry.uuid ) ) ];

		} ) );
		const byGeometry = new Map();
		const active = new Set();
		const walk = node => {

			if ( ! node || typeof node !== 'object' ) {

				add( 'SCENE_INVALID', 'children', node, null, 'must contain scene objects', field );
				return;

			}
			const label = node.name || node.uuid || node.type || field;
			if ( active.has( node ) ) {

				add( 'PARENT_CYCLE', 'children', node.uuid, null, 'must not introduce a cycle', label );
				return;

			}
			active.add( node );
			if ( field === 'scene' ) {

				seen.add( node.uuid );
				names.set( node.uuid, label );

			}
			for ( const key of Object.keys( refs ) ) {

				if ( node[ key ] === undefined ) continue;
				for ( const id of [].concat( node[ key ] ) ) {

					if ( ! refs[ key ].has( id ) ) add( 'REFERENCE_MISSING', key, id, null, 'must refer to an existing UUID', label );

				}

			}
			if ( node.geometry ) {

				if ( ! byGeometry.has( node.geometry ) ) byGeometry.set( node.geometry, [] );
				byGeometry.get( node.geometry ).push( label );

			}
			if ( node.matrix !== undefined ) {

				const m = node.matrix;
				if ( ! Array.isArray( m ) || m.length !== 16 || ! m.every( Number.isFinite ) ) {

					add( 'NUMBER_NOT_FINITE', 'matrix', m, null, 'must contain sixteen finite numbers', label );

				} else {

					const zero = axes.findIndex( ( _, i ) => Math.hypot( ...m.slice( 4 * i, 4 * i + 3 ) ) === 0 );
					if ( zero >= 0 ) add( 'SCALE_ZERO', `scale.${ axes[ zero ] }`, 0, MIN_SCALE, 'must be non-zero', label );
					else {

						const determinant = matrix.fromArray( m ).determinant();
						if ( ! Number.isFinite( determinant ) || determinant === 0 ) add( 'MATRIX_SINGULAR', 'matrix.determinant', determinant, null, 'must be finite and non-zero', label );

					}

				}

			}
			for ( const field of [ 'position', 'scale' ] ) {

				if ( ! Array.isArray( node[ field ] ) ) continue;
				for ( const [ i, axis ] of axes.entries() ) {

					const value = node[ field ][ i ];
					if ( ! Number.isFinite( value ) ) add( 'NUMBER_NOT_FINITE', `${ field }.${ axis }`, value, field === 'scale' ? 1 : 0, 'must be finite', label );
					else if ( field === 'scale' && value === 0 ) add( 'SCALE_ZERO', `scale.${ axis }`, value, MIN_SCALE, 'must be non-zero', label );

				}

			}
			if ( Array.isArray( node.quaternion ) ) {

				const refusal = checkQuaternion( op, 'quaternion', node.quaternion, label );
				if ( refusal ) issues.push( refusal );

			}
			if ( node.children !== undefined && ! Array.isArray( node.children ) ) add( 'SCENE_INVALID', 'children', node.children, null, 'must be an array', label );
			else for ( const child of node.children || [] ) walk( child );
			active.delete( node );

		};
		walk( data.object );
		for ( const geometry of data.geometries || [] ) {

			const position = geometry.data?.attributes?.position;
			if ( ! position ) continue;
			const labels = byGeometry.get( geometry.uuid ) || [ geometry.name || geometry.uuid ];
			const array = position.array;
			if ( ! array ) continue; // Instanced/interleaved attribute references are decoded by ObjectLoader.
			if ( ! array.length ) for ( const label of labels ) add( 'GEOMETRY_EMPTY', 'geometry.position.length', 0, null, 'requires vertex data', label );
			const index = Array.prototype.findIndex.call( array, v => ! Number.isFinite( v ) );
			if ( index !== -1 ) for ( const label of labels ) add( 'GEOMETRY_VERTEX_INVALID', `geometry.position[${ index }]`, array[ index ], null, 'must be finite', label );

		}
		for ( const clip of data.animations || [] ) issues.push( ...validateClipJSON( clip, op, clip.name || clip.uuid ) );

	};
	inspect( json?.scene, 'scene' );
	if ( json?.camera !== undefined ) inspect( json.camera, 'camera' );
	for ( const { object, clip } of json?.animations || [] ) {

		if ( ! seen.has( object ) ) add( 'REFERENCE_MISSING', 'animation.object', object, null, 'must refer to an existing scene object', clip?.name );
		issues.push( ...validateClipJSON( clip, op, names.get( object ) || object ) );

	}
	return issues;

}

export function validateClipJSON( clip, op, label ) {

	const issues = [];
	const add = ( code, argument, received, nearest, requirement ) => issues.push( refuse( code, op, argument, received, nearest, requirement, label ) );
	if ( ! Number.isFinite( clip?.duration ) || clip.duration <= 0 ) add( 'CLIP_DURATION_INVALID', 'clip.duration', clip?.duration, 0.001, 'must be finite and positive' );
	if ( ! Array.isArray( clip?.tracks ) ) {

		add( 'KEYFRAME_TIME_INVALID', 'clip.tracks', clip?.tracks, null, 'requires a track array' );
		return issues;

	}
	for ( const track of clip.tracks ) {

		let previous = -Infinity;
		const field = `track ${ track?.name ?? '(unnamed)' }`;
		if ( ! Array.isArray( track?.times ) || ! track.times.length ) {

			add( 'KEYFRAME_TIME_INVALID', `${ field }.times`, track?.times, null, 'requires an array of key times' );
			continue;

		}
		for ( const [ i, time ] of track.times.entries() ) {

			const t = Math.fround( time );
			const argument = `${ field }.times[${ i }]`;
			if ( ! Number.isFinite( time ) || ! Number.isFinite( t ) || time < 0 ) add( 'KEYFRAME_TIME_INVALID', argument, time, null, 'must be finite and non-negative in Float32' );
			else if ( t === previous ) add( 'KEYFRAME_TIME_DUPLICATE', argument, time, null, 'must distinguish consecutive keys in Float32' );
			else if ( t < previous ) add( 'KEYFRAME_TIME_ORDER', argument, time, null, 'must be strictly increasing' );
			previous = t;

		}
		if ( ! Array.isArray( track.values ) || ! track.values.length || track.values.length % track.times.length !== 0 ) add( 'KEYFRAME_VALUE_INVALID', `${ field }.values.length`, track.values?.length, null, 'must provide equally sized values for each key' );
		else if ( ! [ 'bool', 'string' ].includes( track.type ) ) {

			const i = track.values.findIndex( v => ! Number.isFinite( v ) || ! Number.isFinite( Math.fround( v ) ) );
			if ( i >= 0 ) add( 'KEYFRAME_VALUE_INVALID', `${ field }.values[${ i }]`, track.values[ i ], null, 'must be finite in Float32' );

		}

	}
	return issues;

}

export function assertLoadableScene( json, op ) {

	const issues = validateSceneJSON( json, op );
	if ( issues.length ) throw Object.assign( new Error( issues.map( issue => issue.message ).join( '\n' ) ), { code: 'SCENE_INVALID', issues } );
	return normalizeShortHolds( json );

}

// Keep the first key and the authored clip duration. A constant, two-key
// subframe hold has the same sample at every time with or without the second key.
function normalizeShortHolds( json ) {

	const normalize = clip => {

		let changed = false;
		const tracks = clip.tracks.map( track => {

			if ( track.times.length !== 2 || track.times[ 1 ] - track.times[ 0 ] > 0.00101 ) return track;
			const stride = track.values.length / 2;
			const values = track.values.slice( 0, stride );
			if ( ! values.every( ( value, i ) => value === track.values[ i + stride ] ) ) return track;
			changed = true;
			return { ...track, times: track.times.slice( 0, 1 ), values };

		} );
		return changed ? { ...clip, tracks } : clip;

	};
	const normalizeTable = data => data?.animations?.length ? { ...data, animations: data.animations.map( normalize ) } : data;
	const result = { ...json, scene: normalizeTable( json.scene ) };
	if ( json.camera ) result.camera = normalizeTable( json.camera );
	if ( json.animations?.length ) result.animations = json.animations.map( entry => ( { ...entry, clip: normalize( entry.clip ) } ) );
	return result;

}

export function assertSceneGraph( root ) {

	// Check graph links before the serializer recursively walks them.
	const seen = new Set();
	const queue = [ root ];
	while ( queue.length ) {

		const object = queue.pop();
		if ( seen.has( object ) ) {

			const issue = refuse( 'PARENT_CYCLE', 'save', 'children', object.uuid, null, 'must not revisit an object in the scene graph', object.name || object.uuid );
			throw Object.assign( new Error( issue.message ), { code: 'SCENE_INVALID', issues: [ issue ] } );

		}
		seen.add( object );
		for ( const child of object.children ) queue.push( child );

	}
}
