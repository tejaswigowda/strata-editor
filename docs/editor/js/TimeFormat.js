/** Seconds -> "mm:ss" (minutes keep growing past 59, e.g. 75:00). Fractions are dropped. */
export function formatClock( seconds ) {

	const total = Math.max( 0, Math.floor( Number.isFinite( seconds ) ? seconds : 0 ) );
	const m = Math.floor( total / 60 );
	const s = total % 60;
	return String( m ).padStart( 2, '0' ) + ':' + String( s ).padStart( 2, '0' );

}
