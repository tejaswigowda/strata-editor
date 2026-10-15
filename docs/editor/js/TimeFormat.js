/** Seconds -> "mm:ss" (minutes keep growing past 59, e.g. 75:00). Fractions are dropped. */
export function formatClock( seconds ) {

	const total = Math.max( 0, Math.floor( Number.isFinite( seconds ) ? seconds : 0 ) );
	const m = Math.floor( total / 60 );
	const s = total % 60;
	return String( m ).padStart( 2, '0' ) + ':' + String( s ).padStart( 2, '0' );

}

/** Seconds -> "mm:ss:ms" with three millisecond digits, e.g. 83.25 -> "01:23:250". */
export function formatClockMs( seconds ) {

	const totalMs = Math.max( 0, Math.floor( ( Number.isFinite( seconds ) ? seconds : 0 ) * 1000 + 1e-6 ) );
	return formatClock( totalMs / 1000 ) + ':' + String( totalMs % 1000 ).padStart( 3, '0' );

}
