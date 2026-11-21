import { Box3, DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { resolveSceneSun, solarLocalTime, solarPosition } from './solar.js';

const doubleSide = new MeshBasicMaterial( { side: DoubleSide } );

function meshesFor( scene, ids ) {

	return ids.flatMap( id => {

		const root = scene.getObjectByProperty( 'uuid', id );
		if ( ! root ) throw new Error( `Missing shade analysis geometry: ${ id }` );
		const meshes = [];
		root.traverseVisible( object => {

			if ( ! object.isMesh ) return;
			if ( object.isSkinnedMesh || object.isInstancedMesh || object.morphTargetInfluences ) throw new Error( 'Shade analysis requires static, non-instanced meshes.' );
			const mesh = new Mesh( object.geometry, doubleSide );
			mesh.matrixWorld.copy( object.matrixWorld );
			if ( ! mesh.geometry.boundingBox ) mesh.geometry.computeBoundingBox();
			meshes.push( { mesh, bounds: mesh.geometry.boundingBox.clone().applyMatrix4( mesh.matrixWorld ) } );

		} );
		return meshes;

	} );

}

export function sampleWalkwayShade( scene, { walkway, canopy, instants, spacing = 0.4 } ) {

	const sun = resolveSceneSun( scene );
	if ( ! sun ) throw new Error( 'Bind sunlight to the observation before analyzing shade.' );
	if ( ! Array.isArray( walkway ) || ! Array.isArray( canopy ) || ! Array.isArray( instants ) || ! instants.length || instants.length > 400 || ! Number.isFinite( spacing ) || spacing < 0.05 ) throw new Error( 'Provide walkway UUIDs, canopy UUIDs and up to 400 UTC instants; spacing must be at least 0.05 m.' );
	scene.updateMatrixWorld( true );
	const surface = meshesFor( scene, walkway );
	const blockers = meshesFor( scene, canopy );
	if ( ! surface.length || ! blockers.length ) throw new Error( 'Walkway and canopy both need visible meshes.' );
	const bounds = surface.reduce( ( b, m ) => b.union( m.bounds ), new Box3() );
	const nx = Math.ceil( ( bounds.max.x - bounds.min.x ) / spacing ), nz = Math.ceil( ( bounds.max.z - bounds.min.z ) / spacing );
	if ( nx * nz > 100000 ) throw new Error( 'Shade sample grid too large; increase spacing or narrow the walkway.' );
	const ray = new Raycaster();
	const hit = [];
	const origin = new Vector3(), down = new Vector3( 0, - 1, 0 ), direction = new Vector3();
	const samples = [];
	for ( let i = 0; i < nx; i ++ ) for ( let j = 0; j < nz; j ++ ) {

		origin.set( bounds.min.x + ( i + 0.5 ) * spacing, bounds.max.y + 1, bounds.min.z + ( j + 0.5 ) * spacing );
		ray.set( origin, down );
		hit.length = 0;
		for ( const { mesh, bounds } of surface ) if ( ray.ray.intersectsBox( bounds ) ) mesh.raycast( ray, hit );
		if ( hit.length ) samples.push( origin.clone().setY( Math.max( ...hit.map( h => h.point.y ) ) + 0.0001 ) );

	}
	if ( ! samples.length ) throw new Error( 'No walkway samples; reduce spacing.' );
	return instants.map( instant => {

		const pos = solarPosition( instant, sun.lat, sun.lon );
		const localTime = solarLocalTime( instant, sun.timeZone );
		if ( pos.altitude <= 0 ) return { instant, localTime, fraction: null, shaded: null, samples: samples.length };
		direction.fromArray( pos.direction );
		let shaded = 0;
		for ( const sample of samples ) {

			ray.set( sample, direction );
			for ( const { mesh, bounds } of blockers ) {

				if ( ! ray.ray.intersectsBox( bounds ) ) continue;
				hit.length = 0;
				mesh.raycast( ray, hit );
				if ( hit.length ) { shaded ++; break; }

			}

		}
		return { instant, localTime, fraction: shaded / samples.length, shaded, samples: samples.length };

	} );

}
