// NOAA GML solar calculator equations (Meeus). Geometric elevation, without refraction.
const RAD = Math.PI / 180;
const wrap = ( x, period ) => ( ( x % period ) + period ) % period;
const sin = x => Math.sin( x * RAD );
const cos = x => Math.cos( x * RAD );
export const SOLAR_ALGORITHM = 'NOAA GML (Meeus), geometric';
const legendTimes = new WeakMap();

function utcMillis( instant ) {

	if ( typeof instant !== 'string' || ! /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test( instant ) ) throw new Error( 'Solar instant must be ISO 8601 UTC (Z).' );
	const ms = Date.parse( instant );
	if ( ! Number.isFinite( ms ) || new Date( ms ).toISOString().slice( 0, 19 ) !== instant.slice( 0, 19 ) ) throw new Error( 'Invalid solar instant.' );
	return ms;

}

export function solarPosition( instant, lat, lon ) {

	const ms = utcMillis( instant );
	if ( ! Number.isFinite( lat ) || Math.abs( lat ) > 90 || ! Number.isFinite( lon ) || Math.abs( lon ) > 180 ) throw new Error( 'Invalid solar latitude or longitude.' );
	const t = ( ms / 86400000 + 2440587.5 - 2451545 ) / 36525;
	const l = wrap( 280.46646 + t * ( 36000.76983 + t * 0.0003032 ), 360 );
	const m = 357.52911 + t * ( 35999.05029 - 0.0001537 * t );
	const ecc = 0.016708634 - t * ( 0.000042037 + 0.0000001267 * t );
	const omega = 125.04 - 1934.136 * t;
	const obliquity = 23 + ( 26 + ( 21.448 - t * ( 46.815 + t * ( 0.00059 - t * 0.001813 ) ) ) / 60 ) / 60 + 0.00256 * cos( omega );
	const lambda = l + sin( m ) * ( 1.914602 - t * ( 0.004817 + 0.000014 * t ) ) + sin( 2 * m ) * ( 0.019993 - 0.000101 * t ) + 0.000289 * sin( 3 * m ) - 0.00569 - 0.00478 * sin( omega );
	const dec = Math.asin( sin( obliquity ) * sin( lambda ) ) / RAD;
	const y = Math.tan( obliquity * RAD / 2 ) ** 2;
	const eq = 4 / RAD * ( y * sin( 2 * l ) - 2 * ecc * sin( m ) + 4 * ecc * y * sin( m ) * cos( 2 * l ) - y * y / 2 * sin( 4 * l ) - 1.25 * ecc * ecc * sin( 2 * m ) );
	const h = wrap( ms / 60000 + eq + 4 * lon, 1440 ) / 4 - 180;
	const east = - cos( dec ) * sin( h );
	const north = cos( lat ) * sin( dec ) - sin( lat ) * cos( dec ) * cos( h );
	const up = sin( lat ) * sin( dec ) + cos( lat ) * cos( dec ) * cos( h );
	const altitude = Math.atan2( up, Math.hypot( east, north ) ) / RAD;
	const azimuth = wrap( Math.atan2( east, north ) / RAD, 360 );
	return { altitude, azimuth, direction: [ east, up, - north ], shadowBearing: wrap( azimuth + 180, 360 ), shadowPerHeight: up > 0 ? Math.hypot( east, north ) / up : null };

}

export function solarLocalTime( instant, timeZone ) {

	return new Intl.DateTimeFormat( 'en-US', { timeZone, dateStyle: 'medium', timeStyle: 'medium', hourCycle: 'h23' } ).format( utcMillis( instant ) );

}

export function resolveSceneSun( scene ) {

	const sun = scene.userData.sun;
	if ( ! sun ) return null;
	const source = scene.getObjectByProperty( 'uuid', sun.source );
	if ( sun.derivedFrom !== 'gisLayer.date' || ! source?.userData.gisLayer ) throw new Error( 'Sun must reference a thermal layer with gisLayer.date.' );
	const instant = source.userData.gisLayer.date;
	const position = solarPosition( instant, sun.lat, sun.lon );
	return { ...sun, instant, algorithm: SOLAR_ALGORITHM, localTime: solarLocalTime( instant, sun.timeZone ), ...position };

}

export function applySceneSun( scene ) {

	const sun = resolveSceneSun( scene );
	if ( ! sun ) return null;
	const light = scene.getObjectByProperty( 'uuid', sun.light );
	if ( ! light?.isDirectionalLight ) throw new Error( 'The solar key must be a DirectionalLight.' );
	const target = light.target.getWorldPosition( light.position.clone() );
	const offset = light.position.clone().fromArray( sun.direction ).multiplyScalar( sun.distance ?? 120 );
	const world = target.add( offset );
	light.position.copy( light.parent ? light.parent.worldToLocal( world ) : world );
	light.visible = sun.altitude > 0;
	light.updateMatrixWorld( true );
	light.shadow.needsUpdate = true;
	// This is an auditable cache, not a second editable time source.
	scene.userData.sun.instant = sun.instant;
	scene.userData.sun.algorithm = sun.algorithm;
	const legend = scene.getObjectByProperty( 'uuid', sun.legend );
	if ( legend ) {

		legend.name = `Landsat acquisition: ${ sun.localTime } (${ sun.timeZone })`;
		const texture = legend.material?.map;
		if ( texture && typeof document !== 'undefined' && legendTimes.get( legend ) !== sun.instant ) {

			// Replace the dedicated time label; do not modify the temperature legend artwork.
			const canvas = document.createElement( 'canvas' );
			canvas.width = 1024;
			canvas.height = 96;
			const ctx = canvas.getContext( '2d' );
			ctx.fillStyle = '#101820';
			ctx.fillRect( 0, 0, 1024, 96 );
			ctx.fillStyle = '#fff';
			ctx.font = '32px sans-serif';
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.fillText( `Landsat acquisition: ${ sun.localTime } (${ sun.timeZone })`, 512, 48, 984 );
			texture.image = canvas;
			texture.needsUpdate = true;
			legendTimes.set( legend, sun.instant );

		}

	}
	return sun;

}
