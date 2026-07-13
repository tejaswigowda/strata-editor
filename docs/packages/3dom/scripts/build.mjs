// Build ESM + UMD bundles for CDN / <script> distribution. three stays EXTERNAL
// (peer dep) so it is never duplicated — the consuming page brings its own three.
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';

mkdirSync( new URL( '../dist/', import.meta.url ), { recursive: true } );

const common = {
	entryPoints: [ new URL( '../src/index.js', import.meta.url ).pathname ],
	bundle: true,
	external: [ 'three' ],
	sourcemap: true,
	logLevel: 'info',
};

await build( { ...common, format: 'esm', outfile: new URL( '../dist/3dom.esm.js', import.meta.url ).pathname } );
await build( { ...common, format: 'esm', minify: true, outfile: new URL( '../dist/3dom.esm.min.js', import.meta.url ).pathname } );

// UMD-ish global build. esbuild has no native UMD; `iife` with a global name gives
// a <script>-tag-friendly bundle exposing window.$3DOM. three is read from the
// global (window.THREE) via the alias below so a plain <script> page works too.
await build( {
	...common,
	format: 'iife',
	globalName: '$3DOM',
	minify: true,
	// Map the external `three` import onto the page global for the script build.
	banner: { js: 'var __THREE_GLOBAL__ = (typeof window!=="undefined"&&window.THREE)||{};' },
	plugins: [ {
		name: 'three-global',
		setup( b ) {

			b.onResolve( { filter: /^three$/ }, () => ( { path: 'three', namespace: 'three-global' } ) );
			b.onLoad( { filter: /.*/, namespace: 'three-global' }, () => ( {
				contents: 'module.exports = (typeof window!=="undefined"&&window.THREE)||{};',
				loader: 'js',
			} ) );

		},
	} ],
	outfile: new URL( '../dist/3dom.global.min.js', import.meta.url ).pathname,
} );

console.log( 'built dist/3dom.esm.js, dist/3dom.esm.min.js, dist/3dom.global.min.js' );
