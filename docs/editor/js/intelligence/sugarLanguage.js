// sugarLanguage.js: the Animations tab's code panel is pseudo-JS (`$S('#a').at(1).animate(...)`), so it gets its
// own light Monaco language: syntax highlighting only. As 'javascript' every model is also sent to Monaco's
// TypeScript worker, which recurses once per link of a method chain: a baked track's 200-link
// `.at(..).animate(..)` chain throws "RangeError: Maximum call stack size exceeded" on every validation.
// This language never reaches that worker (and the Script editor, which stays 'javascript', is untouched).

export const SUGAR_LANGUAGE_ID = 'strata-sugar';

export const sugarConfiguration = {
	comments: { lineComment: '//', blockComment: [ '/*', '*/' ] },
	brackets: [ [ '{', '}' ], [ '[', ']' ], [ '(', ')' ] ],
	autoClosingPairs: [
		{ open: '{', close: '}' }, { open: '[', close: ']' }, { open: '(', close: ')' },
		{ open: '\'', close: '\'', notIn: [ 'string', 'comment' ] }, { open: '"', close: '"', notIn: [ 'string', 'comment' ] },
	],
	surroundingPairs: [ { open: '{', close: '}' }, { open: '[', close: ']' }, { open: '(', close: ')' }, { open: '\'', close: '\'' }, { open: '"', close: '"' } ],
};

export const sugarTokens = {
	defaultToken: '',
	keywords: [ 'true', 'false', 'null', 'undefined', 'function', 'return', 'const', 'let', 'var' ],
	tokenizer: {
		root: [
			[ /\/\/.*$/, 'comment' ],
			[ /\/\*/, 'comment', '@comment' ],
			[ /\$[A-Za-z_]\w*/, 'type' ], // $S, $M
			[ /[A-Za-z_]\w*(?=\s*:)/, 'key' ], // { rotateY: 360 }
			[ /[A-Za-z_]\w*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } } ],
			[ /-?\d+(\.\d+)?([eE][+-]?\d+)?/, 'number' ],
			[ /'([^'\\]|\\.)*'/, 'string' ],
			[ /"([^"\\]|\\.)*"/, 'string' ],
			[ /`([^`\\]|\\.)*`/, 'string' ],
			[ /[{}()[\]]/, '@brackets' ],
			[ /[;,.:]/, 'delimiter' ],
		],
		comment: [
			[ /[^/*]+/, 'comment' ],
			[ /\*\//, 'comment', '@pop' ],
			[ /[/*]/, 'comment' ],
		],
	},
};

/** Register the language once on the global `monaco` (safe to call from every editor that wants it). */
export function registerSugarLanguage( monaco ) {

	if ( monaco.languages.getLanguages().some( l => l.id === SUGAR_LANGUAGE_ID ) ) return;
	monaco.languages.register( { id: SUGAR_LANGUAGE_ID, aliases: [ 'Strata sugar' ] } );
	monaco.languages.setLanguageConfiguration( SUGAR_LANGUAGE_ID, sugarConfiguration );
	monaco.languages.setMonarchTokensProvider( SUGAR_LANGUAGE_ID, sugarTokens );

}
