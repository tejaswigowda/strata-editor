export const MIN_SCALE = 0.001;

export const REFUSAL_CODES = Object.freeze( [
	'ARGUMENT_INVALID', 'NUMBER_NOT_FINITE', 'OP_UNAVAILABLE', 'OP_REJECTED', 'OP_EXECUTION_FAILED',
	'SCALE_ZERO', 'SCALE_BELOW_MINIMUM', 'QUAT_NOT_NORMALIZED', 'MATRIX_SINGULAR',
	'GEOMETRY_EMPTY', 'GEOMETRY_VERTEX_INVALID', 'PARENT_CYCLE', 'REFERENCE_MISSING',
	'KEYFRAME_TIME_INVALID', 'KEYFRAME_TIME_DUPLICATE', 'KEYFRAME_TIME_ORDER',
	'KEYFRAME_VALUE_INVALID', 'CLIP_DURATION_INVALID', 'SCENE_INVALID',
] );

function display( value ) {

	if ( Array.isArray( value ) ) return `[${ value.slice( 0, 16 ).map( display ).join( ', ' ) }]`;
	if ( typeof value === 'string' ) return JSON.stringify( value.slice( 0, 180 ) );
	if ( value && typeof value === 'object' ) return '[object]';
	return String( value );

}

export function refuse( code, op, argument, received, nearest, requirement, object ) {

	const result = { success: false, code, op, argument, received, nearest,
		message: `${ op }: ${ object ? `${ display( object ) } ` : '' }${ argument } ${ requirement } (got ${ display( received ) })${ nearest == null ? '' : `; nearest legal ${ display( nearest ) }` }` };
	if ( object ) result.object = object;
	return result;

}

export function checkScale( op, argument, value, object ) {

	if ( ! Number.isFinite( value ) ) return refuse( 'NUMBER_NOT_FINITE', op, argument, value, 1, 'must be finite', object );
	if ( value === 0 ) return refuse( 'SCALE_ZERO', op, argument, value, MIN_SCALE, 'must be non-zero', object );
	if ( Math.abs( value ) < MIN_SCALE ) return refuse( 'SCALE_BELOW_MINIMUM', op, argument, value, Math.sign( value ) * MIN_SCALE, `must have magnitude at least ${ MIN_SCALE }`, object );
	return null;

}

export function checkQuaternion( op, argument, q, object ) {

	const norm = Math.hypot( ...q );
	if ( q.length === 4 && Number.isFinite( norm ) && Math.abs( norm - 1 ) <= 1e-4 ) return null;
	return refuse( 'QUAT_NOT_NORMALIZED', op, argument, q, q.length === 4 && Number.isFinite( norm ) && norm > 0 ? q.map( v => v / norm ) : [ 0, 0, 0, 1 ], 'must be a finite unit quaternion', object );

}
