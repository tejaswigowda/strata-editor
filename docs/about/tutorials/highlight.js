// Dependency-free syntax highlighting for the code blocks in the tutorials.
// Colours every <pre><code> block (JavaScript / JSON, plus shell one-liners such as curl) by
// rewriting its text into <span class="tok-…"> nodes. Text is never parsed as HTML, so it is
// safe, and the visible text (and copy/paste) is unchanged. Styles live in highlight.css.
( function () {

	const KEYWORDS = new Set( ( 'async await break case catch class const continue debugger default delete do else export extends ' +
		'finally for from function if import in instanceof let new of return static super switch throw try typeof var void while yield' ).split( ' ' ) );
	const LITERALS = new Set( [ 'true', 'false', 'null', 'undefined', 'NaN', 'Infinity', 'this' ] );
	const GLOBALS = new Set( [ 'window', 'document', 'scene', 'editor', 'camera', 'renderer', 'console', 'Math', 'JSON', 'Object', 'Array', 'Promise', 'Number', 'String', 'Set', 'Map' ] );

	const TOKEN = new RegExp( [
		'(?<comment>//[^\\n]*|/\\*[\\s\\S]*?\\*/)',
		'(?<string>\'(?:\\\\.|[^\'\\\\\\n])*\'|"(?:\\\\.|[^"\\\\\\n])*"|`(?:\\\\.|[^`\\\\])*`)',
		'(?<regex>/(?![*/])(?:\\\\.|\\[(?:\\\\.|[^\\]\\\\\\n])*\\]|[^/\\\\\\n])+/[dgimsuvy]*)',
		'(?<number>0[xX][0-9a-fA-F_]+|\\d[\\d_]*\\.?\\d*(?:[eE][+-]?\\d+)?|\\.\\d+)',
		'(?<word>[A-Za-z_$][\\w$]*)',
	].join( '|' ), 'y' );

	function span( cls, text ) {

		const el = document.createElement( 'span' );
		el.className = 'tok-' + cls;
		el.textContent = text;
		return el;

	}

	function highlightJS( src ) {

		const out = document.createDocumentFragment();
		let plain = '', i = 0, prevSig = '', prevWord = ''; // last non-space character / word, to tell regex from division

		const flush = () => { if ( plain ) { out.appendChild( document.createTextNode( plain ) ); plain = ''; } };

		while ( i < src.length ) {

			TOKEN.lastIndex = i;
			const m = TOKEN.exec( src );

			if ( ! m ) {

				const ch = src[ i++ ];
				plain += ch;
				if ( ! /\s/.test( ch ) ) { prevSig = ch; prevWord = ''; }
				continue;

			}

			const g = m.groups, text = m[ 0 ];
			let cls = null;

			if ( g.comment ) cls = 'comment';
			else if ( g.string ) cls = 'string';
			else if ( g.regex ) {

				const divides = /[\w$)\]]/.test( prevSig ) && ! KEYWORDS.has( prevWord );
				if ( divides ) { plain += '/'; i++; prevSig = '/'; prevWord = ''; continue; }
				cls = 'regex';

			} else if ( g.number ) cls = 'number';
			else if ( g.word ) {

				const next = src.slice( i + text.length ).match( /^\s*(.)/ );
				const afterDot = prevSig === '.';
				if ( KEYWORDS.has( text ) && ! afterDot ) cls = 'keyword';
				else if ( LITERALS.has( text ) && ! afterDot ) cls = 'literal';
				else if ( next && next[ 1 ] === '(' ) cls = 'function';
				else if ( afterDot ) cls = 'property';
				else if ( /^[A-Z][A-Za-z0-9]*$/.test( text ) && /[a-z]/.test( text ) ) cls = 'class';
				else if ( GLOBALS.has( text ) ) cls = 'global';

			}

			if ( cls ) { flush(); out.appendChild( span( cls, text ) ); } else plain += text;
			i += text.length;
			prevSig = text[ text.length - 1 ];
			prevWord = g.word ? text : '';

		}

		flush();
		return out;

	}

	const SHELL_TOKEN = /(?<comment>(?<=^|\s)#[^\n]*)|(?<string>'[^']*'|"(?:\\.|[^"\\])*")|(?<url>https?:\/\/[^\s'"]+)|(?<flag>(?<=\s)--?[A-Za-z][\w-]*)|(?<command>(?<![^\n])(?:curl|npm|npx|git|node|python3?|cd|mkdir)\b)/g;

	function highlightShell( src ) {

		const out = document.createDocumentFragment();
		let last = 0;
		const re = new RegExp( SHELL_TOKEN.source, 'g' );
		let m;

		while ( ( m = re.exec( src ) ) ) {

			const cls = Object.keys( m.groups ).find( ( k ) => m.groups[ k ] !== undefined );
			if ( m.index > last ) out.appendChild( document.createTextNode( src.slice( last, m.index ) ) );
			out.appendChild( span( cls, m[ 0 ] ) );
			last = m.index + m[ 0 ].length;

		}

		if ( last < src.length ) out.appendChild( document.createTextNode( src.slice( last ) ) );
		return out;

	}

	function highlightAll() {

		document.querySelectorAll( 'pre > code, pre:not(:has(> code))' ).forEach( ( el ) => {

			if ( el.dataset.highlighted ) return;
			const src = el.textContent;
			const isShell = /^\s*(curl|npm|npx|git|node|python3?|cd|mkdir)\s/.test( src );
			el.textContent = '';
			el.appendChild( isShell ? highlightShell( src ) : highlightJS( src ) );
			el.dataset.highlighted = 'true';

		} );

	}

	if ( document.readyState === 'loading' ) document.addEventListener( 'DOMContentLoaded', highlightAll ); else highlightAll();

} )();
