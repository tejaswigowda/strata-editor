import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import * as THREE from '../../../../build/three.module.js';
import { applySceneSun, solarLocalTime, solarPosition } from '../../scene/solar.js';

registerHooks( { resolve: ( specifier, context, next ) => next( specifier === 'three' ? import.meta.resolve( '../../../../build/three.module.js' ) : specifier, context ) } );
const { sampleWalkwayShade } = await import( '../../scene/walkwayShade.js' );
const acquisition = '2025-07-29T18:03:53.434497Z';
const noon = '2025-07-29T19:33:00Z';
const site = [ 33.431791272, -111.667328704 ];

test( 'Mesa matches NOAA GML and SunCalc 1.9.0 reference runs', () => {

	// NOAA: gml.noaa.gov/grad/solcalc/main.js, calcAzEl with zone=0.
	// SunCalc: getPosition(), azimuth converted from south to north clockwise.
	for ( const [ instant, refs ] of [
		[ acquisition, [ [ 65.13128, 121.15457 ], [ 65.13863, 120.83839 ] ] ],
		[ noon, [ [ 75.11211, 179.85677 ], [ 75.21771, 179.55766 ] ] ]
	] ) {

		const p = solarPosition( instant, ...site );
		assert.ok( Math.abs( p.altitude - refs[ 0 ][ 0 ] ) < 0.02 );
		assert.ok( Math.abs( p.azimuth - refs[ 0 ][ 1 ] ) < 0.02 );
		assert.ok( Math.abs( p.altitude - refs[ 1 ][ 0 ] ) < 0.15 );
		assert.ok( Math.abs( p.azimuth - refs[ 1 ][ 1 ] ) < 0.4 );

	}
	assert.match( solarLocalTime( acquisition, 'America/Phoenix' ), /11:03:53/ );
	assert.match( solarLocalTime( acquisition, 'America/Denver' ), /12:03:53/ );
	assert.throws( () => solarPosition( '2025-02-29T12:00:00Z', ...site ), /Invalid/ );
	assert.throws( () => solarPosition( '2025-07-29T11:03:53-07:00', ...site ), /UTC/ );

} );

function fixture() {

	const scene = new THREE.Scene(), source = new THREE.Group(), light = new THREE.DirectionalLight(), legend = new THREE.Sprite();
	source.userData.gisLayer = { date: acquisition };
	scene.add( source, light, legend );
	scene.userData.sun = { source: source.uuid, light: light.uuid, legend: legend.uuid, instant: noon, derivedFrom: 'gisLayer.date', lat: site[ 0 ], lon: site[ 1 ], timeZone: 'America/Phoenix' };
	return { scene, source, light, legend };

}

test( 'light and legend use the thermal source, never the serialized cache', () => {

	const { scene, source, light, legend } = fixture();
	const first = applySceneSun( scene );
	assert.equal( first.instant, acquisition );
	assert.match( legend.name, /11:03:53/ );
	const ray = light.position.clone().sub( light.target.position ).normalize();
	assert.ok( ray.distanceTo( new THREE.Vector3().fromArray( first.direction ) ) < 1e-10 );
	source.userData.gisLayer.date = noon;
	const second = applySceneSun( scene );
	assert.equal( second.instant, noon );
	assert.match( legend.name, /12:33:00/ );
	assert.ok( ray.distanceTo( light.position.clone().normalize() ) > 0.2 );
	assert.equal( scene.userData.sun.instant, noon );
	delete source.userData.gisLayer.date;
	assert.throws( () => applySceneSun( scene ), /UTC/ );

} );

test( 'walkway shade uses mesh occlusion, changes with the instant, and is unavailable at night', () => {

	const { scene } = fixture();
	const pavement = new THREE.Mesh( new THREE.BoxGeometry( 4, 0.1, 4 ) );
	const canopy = new THREE.Mesh( new THREE.PlaneGeometry( 2, 4 ) );
	canopy.rotation.x = - Math.PI / 2;
	const [ x, y, z ] = solarPosition( acquisition, ...site ).direction;
	canopy.position.set( x / y, 1.05, z / y );
	scene.add( pavement, canopy );
	const night = '2025-07-29T07:00:00Z';
	const morning = '2025-07-29T14:00:00Z';
	const result = sampleWalkwayShade( scene, { walkway: [ pavement.uuid ], canopy: [ canopy.uuid ], instants: [ acquisition, night, morning ], spacing: 0.1 } );
	assert.equal( result[ 0 ].samples, 1600 );
	assert.equal( result[ 0 ].fraction, 0.5 );
	assert.equal( result[ 1 ].fraction, null );
	assert.ok( result[ 2 ].fraction < 0.5 );

} );
