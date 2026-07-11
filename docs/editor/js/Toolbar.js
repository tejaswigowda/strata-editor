import { UIPanel, UIButton, UIText } from './libs/ui.js';

function Toolbar( editor ) {

	const signals = editor.signals;
	const strings = editor.strings;

	const container = new UIPanel();
	container.setId( 'toolbar' );

	// Add CSS styles for disabled tools
	const style = document.createElement( 'style' );
	style.textContent = `
		.Button.disabled-tool {
			opacity: 0.5;
			pointer-events: auto;
			cursor: not-allowed !important;
		}
	`;
	document.head.appendChild( style );

	// translate / rotate / scale

	const translateIcon = document.createElement( 'img' );
	translateIcon.title = strings.getKey( 'toolbar/translate' );
	translateIcon.src = 'images/translate.svg';

	const translate = new UIButton();
	translate.dom.className = 'Button selected';
	translate.dom.appendChild( translateIcon );
	translate.onClick( function () {

		selectTransform( 'translate' );

	} );
	container.add( translate );

	const rotateIcon = document.createElement( 'img' );
	rotateIcon.title = strings.getKey( 'toolbar/rotate' );
	rotateIcon.src = 'images/rotate.svg';

	const rotate = new UIButton();
	rotate.dom.appendChild( rotateIcon );
	rotate.onClick( function () {

		selectTransform( 'rotate' );

	} );
	container.add( rotate );

	const scaleIcon = document.createElement( 'img' );
	scaleIcon.title = strings.getKey( 'toolbar/scale' );
	scaleIcon.src = 'images/scale.svg';

	const scale = new UIButton();
	scale.dom.appendChild( scaleIcon );
	scale.onClick( function () {

		selectTransform( 'scale' );

	} );
	container.add( scale );

	// ── Lasso selection tool ──────────────────────────────────────────────────

	let lassoActive = false;
	let editActive = false;
	let currentTransformMode = 'translate';

	const lassoBtn = new UIButton();
	lassoBtn.dom.className = 'Button';
	lassoBtn.dom.title = 'Lasso select (L) — drag to draw a boundary around objects to select multiple at once';
	lassoBtn.dom.style.cssText = 'margin-left:8px;font-size:11px;padding:0 8px;letter-spacing:0.03em;';
	lassoBtn.setTextContent( 'Lasso' );

	lassoBtn.onClick( function () {

		const next = ! lassoActive;

		// Entering lasso must leave edit mode (mutually exclusive tools).
		if ( next && editActive && editor.editModeController ) editor.editModeController.exit();

		signals.lassoModeChanged.dispatch( { active: next } );

	} );

	container.add( lassoBtn );

	// ── Edit Mode button ──────────────────────────────────────────────────────

	const editBtn = new UIButton();
	editBtn.dom.title = 'Edit Mode (Tab / Esc) — select a Mesh first, then drag the gizmo to move vertices';
	editBtn.dom.style.cssText = 'margin-left:8px;font-size:11px;padding:0 8px;letter-spacing:0.03em;';
	editBtn.setTextContent( 'Edit' );

	editBtn.onClick( function () {

		const emc = editor.editModeController;
		if ( ! emc ) return;

		if ( emc.active ) {

			emc.exit();

		} else if ( editor.selected && editor.selected.isMesh ) {

			// Entering edit mode must leave lasso (mutually exclusive tools).
			if ( lassoActive ) signals.lassoModeChanged.dispatch( { active: false } );
			emc.enter( editor.selected );

		}

	} );

	container.add( editBtn );

	// ── Selection mode mini-buttons (visible only in Edit Mode) ───────────────

	const modeBar = document.createElement( 'span' );
	modeBar.style.cssText = 'margin-left:6px;display:none;';

	const makeMode = ( label, mode, key ) => {

		const btn = document.createElement( 'button' );
		btn.textContent = label;
		btn.title = `${ mode } select (${ key })`;
		btn.style.cssText = 'font-size:10px;padding:1px 6px;margin:0 1px;cursor:pointer;';
		btn.addEventListener( 'click', () => editor.editModeController && editor.editModeController.setMode( mode ) );
		modeBar.appendChild( btn );
		return btn;

	};

	const vBtn = makeMode( 'V', 'vertex', '1' );
	const eBtn = makeMode( 'E', 'edge',   '2' );
	const fBtn = makeMode( 'F', 'face',   '3' );

	container.dom.appendChild( modeBar );

	// ── Signal handlers ───────────────────────────────────────────────────────

	// ── Tool state (mutually exclusive: transform | lasso | edit) ──────────────

	function selectTransform( mode ) {

		// Choosing a transform tool leaves lasso and edit mode.
		if ( lassoActive ) signals.lassoModeChanged.dispatch( { active: false } );
		if ( editActive && editor.editModeController ) editor.editModeController.exit();

		signals.transformModeChanged.dispatch( mode );

	}

	function updateToolButtons() {

		// A transform tool is the active tool only when neither lasso nor edit is on.
		const transformIsActive = ! lassoActive && ! editActive;

		// Highlight exactly one active tool. All tool buttons stay fully clickable
		// so the user can always switch directly between tools (e.g. leave lasso).
		translate.dom.classList.toggle( 'selected', transformIsActive && currentTransformMode === 'translate' );
		rotate.dom.classList.toggle( 'selected', transformIsActive && currentTransformMode === 'rotate' );
		scale.dom.classList.toggle( 'selected', transformIsActive && currentTransformMode === 'scale' );

		lassoBtn.dom.classList.toggle( 'selected', lassoActive );
		editBtn.dom.classList.toggle( 'selected', editActive );

		// Edit is the only button with a real precondition: it needs a mesh selected.
		// (This is not tool-exclusivity — the other tools are never greyed out.)
		const canEdit = editActive || ( editor.selected && editor.selected.isMesh );
		editBtn.dom.classList.toggle( 'disabled-tool', ! canEdit );

	}

	// ── Signal handlers ───────────────────────────────────────────────────────

	signals.transformModeChanged.add( function ( mode ) {

		currentTransformMode = mode;
		updateToolButtons();

	} );

	signals.editModeChanged.add( function ( { active, mode } ) {

		editActive = active;
		modeBar.style.display = active ? 'inline' : 'none';

		if ( active && mode ) {

			[ vBtn, eBtn, fBtn ].forEach( b => b.style.fontWeight = 'normal' );
			if ( mode === 'vertex' ) vBtn.style.fontWeight = 'bold';
			if ( mode === 'edge' )   eBtn.style.fontWeight = 'bold';
			if ( mode === 'face' )   fBtn.style.fontWeight = 'bold';

		}

		updateToolButtons();

	} );

	signals.lassoModeChanged.add( function ( { active } ) {

		lassoActive = active;
		updateToolButtons();

	} );

	// Edit availability depends on the current selection.
	signals.objectSelected.add( function () {

		updateToolButtons();

	} );

	// Normalise initial button state.
	updateToolButtons();

	return container;

}

export { Toolbar };
