// ── Modeling operation registry ───────────────────────────────────────────────
// Central registry for all mesh-editing operations.
// Each op is registered with a name, description, and param schema.
// The registry is the single source of truth for both UI and AI invocation.

const _ops = new Map();

/**
 * Register a modeling operation.
 * @param {string} name  — function name as exposed in Shell scope
 * @param {{ description: string, params: Object<string,string>, example?: string }} descriptor
 */
export function registerOp( name, descriptor ) {

	_ops.set( name, descriptor );

}

/** Retrieve a registered op by name. */
export function getOp( name ) {

	return _ops.get( name );

}

/** All registered ops as an array of { name, description, params, example }. */
export function listOps() {

	return [ ..._ops.entries() ].map( ( [ name, d ] ) => ( { name, ...d } ) );

}

/**
 * Serialize the full op list into a compact string for injection into the AI system prompt.
 * Format:  name(param: type, ...) — description
 */
export function serializeForAI() {

	return [ ..._ops.entries() ].map( ( [ name, d ] ) => {

		const paramStr = Object.entries( d.params || {} )
			.map( ( [ k, v ] ) => `${ k }: ${ v }` )
			.join( ', ' );

		return `  ${ name }(${ paramStr }) — ${ d.description }`;

	} ).join( '\n' );

}
