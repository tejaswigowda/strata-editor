import { UIButton, UICheckbox, UIColor, UINumber, UIPanel, UIRow, UISelect, UIText } from './libs/ui.js';
import { SHADERS, SHADER_GROUPS, getShaderDef, normalizeShaderParams, defaultParams } from './shaders/shaderSpec.js';

// The Shader tab: pick a shader, set its parameters, apply it to the selection (one undo step).
// The same engine runs behind the shell's shader() / mtoon() / unshader() (guides/SHADERS.md).

const SCOPE_LABELS = { tree: 'Selected and children', self: 'Selected only', scene: 'Whole scene' };

function SidebarShader( editor ) {

	const container = new UIPanel();
	container.setBorderTop( '0' );
	container.setPaddingTop( '20px' );

	let lib = null;
	const loadLib = () => import( './shaders/ShaderLibrary.js' ).then( m => ( lib = m ) );

	let object = null;
	let controls = {}; // param key → UI element

	const info = ( label, el ) => {

		const row = new UIRow();
		row.add( new UIText( label ).setClass( 'Label' ) );
		row.add( el );
		container.add( row );
		return row;

	};

	const target = new UIText( '' ).setWidth( '150px' ).setFontSize( '12px' );
	info( 'Target', target );

	const current = new UIText( '' ).setWidth( '150px' ).setFontSize( '12px' );
	info( 'Wearing', current );

	const options = {};
	for ( const group of SHADER_GROUPS ) for ( const s of SHADERS ) if ( s.group === group ) options[ s.id ] = group + ': ' + s.label;
	const shaderSelect = new UISelect().setOptions( options ).setWidth( '150px' ).setFontSize( '12px' ).setValue( 'mtoon' );
	info( 'Shader', shaderSelect );

	const desc = new UIText( '' ).setFontSize( '11px' ).setOpacity( 0.7 );
	const descRow = new UIRow();
	descRow.add( desc );
	container.add( descRow );

	const override = new UICheckbox( false );
	const overrideRow = info( 'Override values', override );

	const paramsBox = new UIPanel();
	container.add( paramsBox );

	const scope = new UISelect().setOptions( SCOPE_LABELS ).setWidth( '150px' ).setFontSize( '12px' ).setValue( 'tree' );
	info( 'Apply to', scope );

	const skipOutlines = new UICheckbox( true );
	info( 'Keep outline meshes', skipOutlines );

	const buttons = new UIRow();
	const applyButton = new UIButton( 'Apply' ).setMarginLeft( '90px' );
	const revertButton = new UIButton( 'Revert' ).setMarginLeft( '7px' );
	buttons.add( applyButton, revertButton );
	container.add( buttons );

	const status = new UIText( '' ).setFontSize( '11px' ).setOpacity( 0.8 );
	const statusRow = new UIRow();
	statusRow.add( status );
	container.add( statusRow );

	function buildParams() {

		const def = getShaderDef( shaderSelect.getValue() );
		desc.setValue( def.desc );
		paramsBox.clear();
		controls = {};

		// MToon keeps a model's own values unless told otherwise
		overrideRow.setDisplay( def.id === 'mtoon' ? '' : 'none' );
		paramsBox.setDisplay( def.id === 'mtoon' && ! override.getValue() ? 'none' : '' );

		const defaults = defaultParams( def.id );
		for ( const p of def.params ) {

			let el;
			if ( p.type === 'color' ) el = new UIColor().setValue( defaults[ p.key ] );
			else if ( p.type === 'number' ) el = new UINumber( defaults[ p.key ] ).setWidth( '60px' ).setRange( p.min, p.max ).setStep( p.step * 10 ).setPrecision( p.step < 0.01 ? 4 : 2 );
			else el = new UISelect().setOptions( Object.fromEntries( p.options.map( o => [ o, o ] ) ) ).setWidth( '60px' ).setValue( defaults[ p.key ] );

			controls[ p.key ] = el;
			const row = new UIRow();
			row.add( new UIText( p.label ).setClass( 'Label' ) );
			row.add( el );
			paramsBox.add( row );

		}

	}

	function readParams() {

		const def = getShaderDef( shaderSelect.getValue() );
		if ( def.id === 'mtoon' && ! override.getValue() ) return {};
		const out = {};
		for ( const p of def.params ) out[ p.key ] = controls[ p.key ].getValue();
		return out;

	}

	function roots() {

		return scope.getValue() === 'scene' ? [ editor.scene ] : [ object ];

	}

	function filterFor() {

		return scope.getValue() === 'self' ? ( m => m === object ) : undefined;

	}

	function say( text, bad ) {

		status.setValue( text );
		status.dom.style.color = bad ? '#e57373' : '';

	}

	function refresh() {

		if ( ! object ) return;
		let meshes = 0;
		object.traverse( o => { if ( o.isMesh ) meshes ++; } );
		target.setValue( ( object.name || object.type ) + ' (' + meshes + ' mesh' + ( meshes === 1 ? '' : 'es' ) + ')' );

		if ( ! lib ) { current.setValue( '…' ); loadLib().then( refresh ).catch( () => current.setValue( 'unavailable' ) ); return; }

		const worn = new Set();
		object.traverse( o => { if ( o.isMesh ) { const id = lib.describeShader( o ); if ( id ) worn.add( id ); } } );
		current.setValue( [ ...worn ].join( ', ' ) || 'none' );

	}

	applyButton.onClick( async function () {

		if ( ! object ) return;
		try {

			const id = shaderSelect.getValue();
			const params = readParams();
			const n = normalizeShaderParams( id, params, id !== 'mtoon' );
			if ( ! n.ok ) throw new Error( n.errors.join( '; ' ) );
			await loadLib();
			const r = lib.executeShader( editor, roots(), id, params, { skipOutlines: skipOutlines.getValue(), filter: filterFor() } );
			say( 'Applied ' + r.id + ' to ' + r.meshes + ' mesh' + ( r.meshes === 1 ? '' : 'es' ) + ' (' + r.materials + ' material' + ( r.materials === 1 ? '' : 's' ) + '). Undo with Ctrl+Z.' );

		} catch ( e ) {

			say( e.message, true );

		}

		refresh();

	} );

	revertButton.onClick( async function () {

		if ( ! object ) return;
		try {

			await loadLib();
			const n = lib.executeRevert( editor, roots(), { skipOutlines: false, filter: filterFor() } ).meshes;
			say( n ? 'Reverted ' + n + ' mesh' + ( n === 1 ? '' : 'es' ) + '.' : 'Nothing to revert (no recorded original material).' );

		} catch ( e ) {

			say( e.message, true );

		}

		refresh();

	} );

	shaderSelect.onChange( buildParams );
	override.onChange( buildParams );

	buildParams();

	editor.signals.objectSelected.add( function ( selected ) {

		object = selected;
		status.setValue( '' );
		refresh();

	} );

	editor.signals.materialChanged.add( refresh );
	editor.signals.sceneGraphChanged.add( refresh );

	return container;

}

export { SidebarShader };
