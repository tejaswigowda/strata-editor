import { CanvasTexture, Sprite, SpriteMaterial } from 'three';
import { applySceneSun } from './solar.js';
import { sampleWalkwayShade } from './walkwayShade.js';

const sourceId = '2e3d205c-d6de-422d-9899-812856f6fa6f';
const lightId = 'db8e1e3e-4700-4aef-af61-8d46f904d0d4';
const legendId = 'e3517f65-d0bd-4db3-87e4-914437c4692e';
const walkwayId = '50bdb762-201d-4eb0-b8c3-ae4e42928edf';

export function configureFutureFluxSun( scene ) {

	const source = scene.getObjectByProperty( 'uuid', sourceId );
	const light = scene.getObjectByProperty( 'uuid', lightId );
	const original = scene.getObjectByProperty( 'uuid', legendId );
	if ( ! source?.userData.gisLayer?.date || ! light?.isDirectionalLight || ! original?.isSprite ) throw new Error( 'Open the FutureFlux Mesa scene before configuring observed sunlight.' );
	let timeLabel = source.children.find( object => object.userData.solarTimeLabel );
	if ( ! timeLabel ) {

		timeLabel = new Sprite( new SpriteMaterial( { map: new CanvasTexture( document.createElement( 'canvas' ) ) } ) );
		timeLabel.userData.solarTimeLabel = true;
		timeLabel.scale.set( original.scale.x, original.scale.x * 96 / 1024, 1 );
		timeLabel.position.copy( original.position );
		timeLabel.position.y -= ( original.scale.y + timeLabel.scale.y ) / 2;
		source.add( timeLabel );

	}
	scene.userData.sun = { source: sourceId, light: lightId, legend: timeLabel.uuid, derivedFrom: 'gisLayer.date', lat: 33.431791272, lon: -111.667328704, timeZone: 'America/Phoenix' };
	light.name = 'Sun at Landsat acquisition';
	light.color.set( '#fff4df' );
	for ( const node of scene.children ) {

		if ( node.isDirectionalLight && node !== light ) node.visible = false;
		if ( node.name === 'Illustrative cooling — proposed trees' || node.name === 'Conceptual shade benefit — not measured cooling' ) node.visible = false;

	}
	return applySceneSun( scene );

}

export function analyzeFutureFluxShade( scene, instants, spacing ) {

	const roots = scene.children;
	const baseline = roots.filter( o => /^tree[45] \/ planted \d+$/.test( o.name ) );
	const proposal = roots.filter( o => /^Tree-only concept — stage [123]$/.test( o.name ) );
	if ( ! baseline.length || ! proposal.length || proposal.some( o => o.scale.lengthSq() < 0.01 ) ) throw new Error( 'Scrub to after all proposed trees appear; analysis uses the sampled scene pose.' );
	const common = { walkway: [ walkwayId ], instants, spacing };
	return {
		baseline: sampleWalkwayShade( scene, { ...common, canopy: baseline.map( o => o.uuid ) } ),
		proposal: sampleWalkwayShade( scene, { ...common, canopy: baseline.concat( proposal ).map( o => o.uuid ) } )
	};

}
