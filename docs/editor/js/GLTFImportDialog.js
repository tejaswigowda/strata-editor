import { UIRow, UIText, UICheckbox, UIButton, UISelect, UINumber } from './libs/ui.js';
import { PRESETS, measureObject, formatBytes } from './mesh/GeometryOptimizer.js';

// ── GLTFImportDialog ──────────────────────────────────────────────────────────
// Import wizard for glTF/GLB assets. Besides the existing "import as scene"
// option, it offers optional geometry compression (weld / simplify / quantize)
// with presets and a live before/after size estimate. When an imported object is
// passed to the constructor the compression section is shown with real stats;
// otherwise the dialog degrades to just the "as scene" checkbox.

class GLTFImportDialog {

	constructor( strings, object = null, opts = {} ) {

		this.strings = strings;
		this.object = object;
		this.opts = opts;

		const dom = document.createElement( 'div' );
		dom.className = 'Dialog';
		this.dom = dom;

		const background = document.createElement( 'div' );
		background.className = 'Dialog-background';
		background.addEventListener( 'click', () => this.cancel() );
		dom.appendChild( background );

		const content = document.createElement( 'div' );
		content.className = 'Dialog-content';
		dom.appendChild( content );

		// Title

		const titleBar = document.createElement( 'div' );
		titleBar.className = 'Dialog-title';
		titleBar.textContent = opts.title || strings.getKey( 'dialog/gltf/title' );
		content.appendChild( titleBar );

		// Body

		const body = document.createElement( 'div' );
		body.className = 'Dialog-body';
		content.appendChild( body );

		// As Scene Checkbox (hidden in export mode)

		this.asSceneCheckbox = new UICheckbox( false );

		if ( ! opts.hideAsScene ) {

			const asSceneRow = new UIRow();
			body.appendChild( asSceneRow.dom );
			asSceneRow.add( this.asSceneCheckbox );
			asSceneRow.add( new UIText( strings.getKey( 'dialog/gltf/asScene' ) ).setMarginLeft( '6px' ) );

		}

		// Compression section (only when we have an object to measure)

		if ( object !== null ) {

			this._buildCompressionUI( body );

			if ( opts.defaultPreset && PRESETS[ opts.defaultPreset ] ) {

				this.presetSelect.setValue( opts.defaultPreset );
				this._applyPreset( opts.defaultPreset );

			}

		}

		// Buttons

		const buttonsRow = document.createElement( 'div' );
		buttonsRow.className = 'Dialog-buttons';
		body.appendChild( buttonsRow );

		const okButton = new UIButton( opts.confirmLabel || strings.getKey( 'dialog/ok' ) );
		okButton.setWidth( '80px' );
		okButton.onClick( () => this.confirm() );
		buttonsRow.appendChild( okButton.dom );

		const cancelButton = new UIButton( strings.getKey( 'dialog/cancel' ) );
		cancelButton.setWidth( '80px' );
		cancelButton.setMarginLeft( '8px' );
		cancelButton.onClick( () => this.cancel() );
		buttonsRow.appendChild( cancelButton.dom );

		// Promise handlers

		this.resolve = null;
		this.reject = null;

	}

	_buildCompressionUI( body ) {

		// Section divider + heading
		const divider = document.createElement( 'div' );
		divider.style.cssText = 'border-top:1px solid rgba(255,255,255,0.1);margin:12px 0 8px;padding-top:10px;font-weight:bold;';
		divider.textContent = 'Compress geometry';
		body.appendChild( divider );

		const before = measureObject( this.object );
		this._before = before;

		// Preset selector
		const presetRow = new UIRow();
		presetRow.add( new UIText( 'Preset' ).setClass( 'Label' ) );
		const presetSelect = new UISelect().setOptions( {
			none: 'None', light: 'Light', medium: 'Medium', aggressive: 'Aggressive',
		} ).setWidth( '150px' ).setValue( 'none' );
		presetRow.add( presetSelect );
		body.appendChild( presetRow.dom );
		this.presetSelect = presetSelect;

		// Toggles
		const mkToggle = ( label, checked ) => {

			const row = new UIRow();
			const cb = new UICheckbox( checked );
			row.add( cb );
			row.add( new UIText( label ).setMarginLeft( '6px' ) );
			body.appendChild( row.dom );
			return cb;

		};

		this.weldCheckbox = mkToggle( 'Weld duplicate vertices', false );
		this.simplifyCheckbox = mkToggle( 'Simplify mesh (reduce triangles)', false );

		// Simplify amount
		const simplifyRow = new UIRow();
		simplifyRow.add( new UIText( 'Reduce by' ).setClass( 'Label' ) );
		const simplifyAmount = new UINumber( 25 ).setWidth( '50px' ).setRange( 0, 95 ).setStep( 5 ).setNudge( 1 ).setUnit( '%' );
		simplifyRow.add( simplifyAmount );
		simplifyRow.add( new UIText( 'of triangles' ).setMarginLeft( '6px' ) );
		body.appendChild( simplifyRow.dom );
		this.simplifyAmount = simplifyAmount;
		this._simplifyRow = simplifyRow;

		this.quantizeNormalsCheckbox = mkToggle( 'Quantize normals / tangents (16-bit)', false );
		this.quantizeUVsCheckbox = mkToggle( 'Quantize UVs (16-bit, when untiled)', false );

		// Slow-mesh warning
		const warn = document.createElement( 'div' );
		warn.style.cssText = 'font-size:11px;opacity:0.6;margin:2px 0 6px;';
		warn.textContent = before.vertices > 200000
			? '\u26a0 Large mesh — simplification may take a while.'
			: '';
		body.appendChild( warn );

		// Stats
		const stats = document.createElement( 'div' );
		stats.style.cssText = 'font:11px/1.6 monospace;background:rgba(0,0,0,0.25);border-radius:4px;padding:6px 8px;margin-top:6px;';
		body.appendChild( stats );
		this._stats = stats;

		// Wiring
		presetSelect.onChange( () => this._applyPreset( presetSelect.getValue() ) );

		[ this.weldCheckbox, this.simplifyCheckbox, this.quantizeNormalsCheckbox, this.quantizeUVsCheckbox ]
			.forEach( ( cb ) => cb.onChange( () => this._refresh() ) );
		this.simplifyAmount.onChange( () => this._refresh() );

		this._refresh();

	}

	_applyPreset( name ) {

		const p = PRESETS[ name ] || PRESETS.none;
		this.weldCheckbox.setValue( p.weld );
		this.simplifyCheckbox.setValue( p.simplify );
		this.simplifyAmount.setValue( Math.round( p.simplifyRatio * 100 ) );
		this.quantizeNormalsCheckbox.setValue( p.quantizeNormals );
		this.quantizeUVsCheckbox.setValue( p.quantizeUVs );
		this._refresh();

	}

	// Compute the currently selected options from the controls.
	_options() {

		return {
			weld: this.weldCheckbox.getValue(),
			weldTolerance: 1e-4,
			simplify: this.simplifyCheckbox.getValue(),
			simplifyRatio: Math.min( 0.95, this.simplifyAmount.getValue() / 100 ),
			quantizeNormals: this.quantizeNormalsCheckbox.getValue(),
			quantizeUVs: this.quantizeUVsCheckbox.getValue(),
		};

	}

	_anyEnabled( o ) {

		return o.weld || ( o.simplify && o.simplifyRatio > 0 ) || o.quantizeNormals || o.quantizeUVs;

	}

	// Rough, honest estimate — real numbers are logged after the pipeline runs.
	_estimateAfter( before, o ) {

		let vScale = 1;
		if ( o.simplify && o.simplifyRatio > 0 ) vScale *= ( 1 - o.simplifyRatio );

		let quantSave = 0;
		if ( o.quantizeNormals ) quantSave += 0.12;
		if ( o.quantizeUVs ) quantSave += 0.06;

		const byteScale = vScale * ( 1 - quantSave );

		return {
			meshes: before.meshes,
			vertices: Math.round( before.vertices * vScale ),
			triangles: Math.round( before.triangles * vScale ),
			bytes: Math.round( before.bytes * byteScale ),
		};

	}

	_refresh() {

		const o = this._options();
		this._simplifyRow.setDisplay( o.simplify ? '' : 'none' );

		const before = this._before;
		const enabled = this._anyEnabled( o );
		const after = enabled ? this._estimateAfter( before, o ) : before;

		const pct = before.bytes > 0 ? Math.max( 0, Math.round( ( 1 - after.bytes / before.bytes ) * 100 ) ) : 0;

		this._stats.innerHTML =
			`Original :  ${ before.triangles.toLocaleString() } tris \u00b7 ${ before.vertices.toLocaleString() } verts \u00b7 ${ formatBytes( before.bytes ) }<br>` +
			( enabled
				? `\u2248 Result  :  ${ after.triangles.toLocaleString() } tris \u00b7 ${ after.vertices.toLocaleString() } verts \u00b7 ${ formatBytes( after.bytes ) }  <span style="color:#7ec699">(\u2212${ pct }%)</span>`
				: '<span style="opacity:0.6">No compression selected</span>' );

	}

	show() {

		document.body.appendChild( this.dom );

		return new Promise( ( resolve, reject ) => {

			this.resolve = resolve;
			this.reject = reject;

		} );

	}

	confirm() {

		const result = { asScene: this.asSceneCheckbox.getValue(), compress: false, compressionOptions: null };

		if ( this.object !== null ) {

			const o = this._options();

			if ( this._anyEnabled( o ) ) {

				result.compress = true;
				result.compressionOptions = o;

			}

		}

		this.dom.remove();

		if ( this.resolve ) this.resolve( result );

	}

	cancel() {

		this.dom.remove();

		if ( this.reject ) this.reject( new Error( 'Import cancelled' ) );

	}

}

export { GLTFImportDialog };
