import { checkScale, refuse } from './opRefusals.js';
import { validateClipJSON } from './sceneValidation.js';

export function validateCommand( command ) {

	const { type, object } = command;
	if ( type === 'MultiCmdsCommand' ) {

		for ( const member of command.cmdArray ) {

			const refusal = validateCommand( member );
			if ( refusal ) return refusal;

		}
		return null;

	}

	const transform = {
		SetScaleCommand: [ 'scale', command.newScale ],
		SetPositionCommand: [ 'position', command.newPosition ],
		SetRotationCommand: [ 'rotation', command.newRotation ],
	}[ type ];
	const label = object?.name || object?.uuid;
	if ( type === 'AddAnimationClipCommand' ) {

		const clip = command.clip;
		return validateClipJSON( clip && clip.constructor.toJSON( clip ), 'addClip', label )[ 0 ] || null;

	}
	if ( transform ) {

		const [ field, value ] = transform;
		for ( const axis of [ 'x', 'y', 'z' ] ) {

			const argument = `${ field }.${ axis }`;
			const result = field === 'scale' ? checkScale( field, argument, value?.[ axis ], label )
				: Number.isFinite( value?.[ axis ] ) ? null : refuse( 'NUMBER_NOT_FINITE', field, argument, value?.[ axis ], 0, 'must be finite', label );
			if ( result ) return result;

		}

	}

	if ( type === 'MoveObjectCommand' ) {

		const seen = new Set( [ object ] );
		for ( let parent = command.newParent; parent; parent = parent.parent ) {

			if ( seen.has( parent ) ) return refuse( 'PARENT_CYCLE', 'reparent', 'parent', command.newParent.uuid, object.parent?.uuid ?? null, 'must not introduce a cycle', label );
			seen.add( parent );

		}

	}

	if ( type === 'SetGeometryCommand' ) {

		const position = command.newGeometry?.getAttribute( 'position' );
		if ( ! position?.count ) return refuse( 'GEOMETRY_EMPTY', 'setGeometry', 'position.count', position?.count ?? 0, null, 'requires vertex data', label );
		for ( let i = 0; i < position.count; i ++ ) {

			const vertex = [ position.getX( i ), position.getY( i ), position.getZ( i ) ];
			if ( ! vertex.every( Number.isFinite ) ) return refuse( 'GEOMETRY_VERTEX_INVALID', 'setGeometry', `position[${ i }]`, vertex, null, 'must contain finite vertices', label );

		}

	}
	return null;

}
