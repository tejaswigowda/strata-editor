// timelineCodeMap.js: which line of the Animations tab's code panel describes a given event.
// Pure (no DOM, no Monaco) so the panel and the node test share one definition.
//
// The panel text is a list of blocks joined by ONE blank line. A track block is either a single line
//   $S('#a').at(1).animate(...);
// or, with several events, the selector line followed by one indented `.at(..)` line per event:
//   $S('#a')
//     .at(1).animate(...)
//     .at(2).animate(...);

/**
 * @param {string[]} blocks   the panel's text blocks, in order (each may contain newlines)
 * @param {{ block: number, ids: string[] }[]} tracks   for each track block: its index in `blocks` and
 *        the event ids it prints, in the order printed
 * @returns {Map<string, number>} event id -> 1-based line number in the joined text
 */
export function eventLineMap( blocks, tracks ) {

	const starts = [];
	let line = 1;
	for ( const b of blocks ) {

		starts.push( line );
		line += String( b ).split( '\n' ).length + 1; // the block, then the blank separator line

	}

	const lines = new Map();
	for ( const t of tracks ) {

		const start = starts[ t.block ];
		if ( start === undefined ) continue;
		const chained = t.ids.length > 1; // one event shares the selector's line, several get one line each after it
		t.ids.forEach( ( id, i ) => lines.set( id, start + ( chained ? 1 + i : 0 ) ) );

	}
	return lines;

}
