import {
	ASPECT_PRESETS, DEFAULTS, SAFE_ACTION, SAFE_TITLE,
	aspectRatio, effectiveState, frameRect, hideOutlinePasses, loadSettings, safeRect, saveSettings
} from './ViewLookLogic.js';

// ── ViewLook.js ───────────────────────────────────────────────────────────────
// Two small viewport buttons (bottom right, beside the shading select) and the DOM overlay they drive:
//
//   Frame  letterbox bars for an aspect preset (16:9, 2.39:1, 1.85:1, 4:3, 1:1, 9:16, or the Render
//          tab's output aspect) plus optional title / action safe guides.
//   Look   vignette, film grain and a soft glow, with intensity sliders, plus a toggle that hides the
//          MToon / toon outline passes while editing.
//
// Everything is viewport-only: the overlay is pointer-events:none DOM above the canvas, the glow is a
// small blurred copy of the frame added with a screen blend, and nothing here is saved in the scene or
// reaches the Render tab's own offscreen renderer. Settings live in localStorage ('strata/viewLook'),
// all off by default. The overlay is hidden while the Render tab renders (pauseViewportRendering) and,
// unless "Apply in present mode" is ticked, in present mode. Logic is in ViewLookLogic.js.

const SVG = inner => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ inner }</svg>`;
const FRAME_ICON = SVG( '<rect x="3" y="6" width="18" height="12" rx="1"/><path d="M7 10v4M17 10v4" stroke-width="1.4"/>' );
const LOOK_ICON = SVG( '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" stroke-width="1.2"/>' );

const GLOW_MIN_INTERVAL = 33; // ms between glow refreshes (it is a tiny copy, ~30 fps is plenty)
const GLOW_DIVISOR = 16; // glow copy is the frame at 1/16 size; the browser's smoothing does the blur

function ViewLook( editor, requestRender = function () {} ) {

	const signals = editor.signals;
	let settings = loadSettings( window.localStorage );
	let exporting = false;
	let lastGlow = 0;
	let ready = false;
	let frame = { x: 0, y: 0, width: 0, height: 0 };

	// ── overlay ──────────────────────────────────────────────────────────────

	const overlay = el( 'div', 'vl-overlay' );
	overlay.id = 'viewport-look';
	overlay.setAttribute( 'aria-hidden', 'true' );

	const stage = el( 'div', 'vl-stage' );
	overlay.appendChild( stage );

	const glow = el( 'canvas', 'vl-glow' );
	const vignette = el( 'div', 'vl-vignette' );
	const grain = el( 'div', 'vl-grain' );
	const safeAction = el( 'div', 'vl-safe vl-safe-action' );
	const safeTitle = el( 'div', 'vl-safe vl-safe-title' );
	const centerMark = el( 'div', 'vl-center' );
	safeAction.dataset.label = 'action safe';
	safeTitle.dataset.label = 'title safe';
	stage.append( glow, vignette, grain, safeAction, safeTitle, centerMark );

	const glowContext = glow.getContext( '2d' );

	function isPresent() {

		return document.body.classList.contains( 'present-mode' );

	}

	function renderSize() {

		const out = editor.renderOutput;
		try { return out && out.getSize ? out.getSize() : null; } catch ( e ) { return null; }

	}

	function layout() {

		const state = effectiveState( settings, { presentMode: isPresent(), exporting } );
		const width = overlay.clientWidth, height = overlay.clientHeight;
		const ratio = state.frame === 'off' ? null : aspectRatio( state.frame, renderSize() );
		frame = frameRect( width, height, ratio );

		stage.style.left = frame.x + 'px';
		stage.style.top = frame.y + 'px';
		stage.style.width = frame.width + 'px';
		stage.style.height = frame.height + 'px';

		const action = safeRect( { x: 0, y: 0, width: frame.width, height: frame.height }, SAFE_ACTION );
		const title = safeRect( { x: 0, y: 0, width: frame.width, height: frame.height }, SAFE_TITLE );
		place( safeAction, action );
		place( safeTitle, title );

		const cw = Math.max( 1, Math.ceil( frame.width / GLOW_DIVISOR ) ), ch = Math.max( 1, Math.ceil( frame.height / GLOW_DIVISOR ) );
		if ( glow.width !== cw ) glow.width = cw;
		if ( glow.height !== ch ) glow.height = ch;

	}

	function place( node, rect ) {

		node.style.left = rect.x + 'px';
		node.style.top = rect.y + 'px';
		node.style.width = rect.width + 'px';
		node.style.height = rect.height + 'px';

	}

	function update() {

		const state = effectiveState( settings, { presentMode: isPresent(), exporting } );

		overlay.classList.toggle( 'vl-on', ! exporting && ( state.frame !== 'off' || state.safe || state.vignette > 0 || state.grain > 0 || state.glow > 0 ) );
		stage.classList.toggle( 'vl-framed', state.frame !== 'off' );
		safeAction.hidden = safeTitle.hidden = centerMark.hidden = ! state.safe;
		vignette.hidden = ! ( state.vignette > 0 );
		grain.hidden = ! ( state.grain > 0 );
		glow.hidden = ! ( state.glow > 0 );
		vignette.style.setProperty( '--vl-amount', String( state.vignette ) );
		grain.style.setProperty( '--vl-amount', String( state.grain ) );
		glow.style.setProperty( '--vl-amount', String( state.glow ) );

		layout();
		refreshControls();
		if ( ready ) requestRender(); // a fresh frame gives the glow its pixels and applies the outline toggle

	}

	function change( patch ) {

		settings = { ...settings, ...patch };
		saveSettings( window.localStorage, settings );
		update();

	}

	// ── buttons + popovers ───────────────────────────────────────────────────

	const controls = el( 'span', 'vl-controls' );
	const frameButton = makeButton( 'vl-frame-button', FRAME_ICON, 'Frame guides: letterbox aspect and safe areas' );
	const lookButton = makeButton( 'vl-look-button', LOOK_ICON, 'Look: vignette, film grain, glow, outline preview' );
	const framePanel = makePanel( 'Frame guides' );
	const lookPanel = makePanel( 'Viewport look' );
	controls.append( frameButton, lookButton, framePanel, lookPanel );

	const popovers = [ [ frameButton, framePanel ], [ lookButton, lookPanel ] ];

	function setOpen( button, panel, open ) {

		panel.hidden = ! open;
		button.setAttribute( 'aria-expanded', open ? 'true' : 'false' );

	}

	function closeAll( returnFocus ) {

		for ( const [ button, panel ] of popovers ) {

			const wasOpen = ! panel.hidden;
			setOpen( button, panel, false );
			if ( wasOpen && returnFocus ) button.focus();

		}

	}

	for ( const [ button, panel ] of popovers ) {

		button.addEventListener( 'click', function () {

			const open = panel.hidden;
			closeAll( false );
			setOpen( button, panel, open );
			if ( open ) {

				layout();
				const first = panel.querySelector( 'input, select, button' );
				if ( first ) first.focus();

			}

		} );

	}

	document.addEventListener( 'pointerdown', function ( event ) {

		if ( ! controls.contains( event.target ) ) closeAll( false );

	} );

	controls.addEventListener( 'keydown', function ( event ) {

		if ( event.key === 'Escape' ) {

			closeAll( true );
			event.stopPropagation();

		}

	} );

	// Frame panel

	const frameSelect = el( 'select', 'vl-select' );
	frameSelect.setAttribute( 'aria-label', 'Letterbox aspect ratio' );
	for ( const preset of ASPECT_PRESETS ) {

		const option = el( 'option' );
		option.value = preset.id;
		option.textContent = preset.label;
		frameSelect.appendChild( option );

	}

	frameSelect.addEventListener( 'change', () => change( { frame: frameSelect.value } ) );
	framePanel.body.append( labelled( 'Aspect', frameSelect ) );

	const safeBox = checkbox( 'Title / action safe guides', 'Show title-safe and action-safe guides', checked => change( { safe: checked } ) );
	framePanel.body.append( safeBox.label );
	framePanel.body.append( note( 'Bars and guides are a viewport overlay only; exported frames are never cropped. "Match render" uses the Render tab\u2019s output resolution. Action safe 93 %, title safe 90 %.' ) );

	// Look panel

	const vignetteRow = sliderRow( 'Vignette', 'Vignette', ( on, amount ) => change( { vignette: on, vignetteAmount: amount } ) );
	const grainRow = sliderRow( 'Film grain', 'Film grain', ( on, amount ) => change( { grain: on, grainAmount: amount } ) );
	const glowRow = sliderRow( 'Glow', 'Glow', ( on, amount ) => change( { glow: on, glowAmount: amount } ) );
	lookPanel.body.append( vignetteRow.node, grainRow.node, glowRow.node );

	const outlineBox = checkbox( 'Hide toon outlines', 'Hide MToon outline passes in the viewport (preview only)', checked => change( { hideOutlines: checked } ) );
	lookPanel.body.append( outlineBox.label );

	const presentBox = checkbox( 'Apply in present mode', 'Apply frame and look settings in present mode', checked => change( { inPresent: checked } ) );
	lookPanel.body.append( presentBox.label );

	const reset = el( 'button', 'vl-reset' );
	reset.type = 'button';
	reset.textContent = 'Reset';
	reset.setAttribute( 'aria-label', 'Reset frame and look settings' );
	reset.addEventListener( 'click', () => change( { ...DEFAULTS } ) );
	lookPanel.body.append( reset );

	lookPanel.body.append( note( 'Viewport only: never applied while the Render tab renders, and not saved in the scene. Glow is a soft screen-blended blur of the frame, not an HDR bloom. Outlines are shown whenever a material has one; this hides them for a cleaner view (the "as render" shading ignores it).' ) );

	function refreshControls() {

		frameSelect.value = settings.frame;
		const size = renderSize();
		const renderOption = [ ...frameSelect.options ].find( o => o.value === 'render' );
		if ( renderOption ) renderOption.textContent = size ? `Match render (${ size.width }\u00d7${ size.height })` : 'Match render';
		safeBox.input.checked = settings.safe;
		vignetteRow.set( settings.vignette, settings.vignetteAmount );
		grainRow.set( settings.grain, settings.grainAmount );
		glowRow.set( settings.glow, settings.glowAmount );
		outlineBox.input.checked = settings.hideOutlines;
		presentBox.input.checked = settings.inPresent;

		frameButton.classList.toggle( 'selected', settings.frame !== 'off' || settings.safe );
		lookButton.classList.toggle( 'selected', settings.vignette || settings.grain || settings.glow || settings.hideOutlines );

	}

	// ── viewport hooks ───────────────────────────────────────────────────────

	signals.pauseViewportRendering.add( function () { exporting = true; update(); } );
	signals.resumeViewportRendering.add( function () { exporting = false; update(); } );
	window.addEventListener( 'strata:render-output-changed', update );

	new MutationObserver( update ).observe( document.body, { attributes: true, attributeFilter: [ 'class' ] } );

	if ( typeof ResizeObserver === 'function' ) {

		new ResizeObserver( layout ).observe( overlay );

	} else {

		window.addEventListener( 'resize', layout );

	}

	update();
	ready = true; // the viewport's render() is not safe to call until its own setup has run

	return {

		overlay,
		controls,

		/** True when the viewport should leave out toon outline passes this frame. */
		outlinesHidden() {

			return effectiveState( settings, { presentMode: isPresent(), exporting } ).hideOutlines;

		},

		hideOutlines( root ) {

			return hideOutlinePasses( root );

		},

		/** Called by the viewport right after it draws; feeds the glow's small blurred copy. */
		afterRender( source ) {

			if ( glow.hidden || ! glowContext || ! source || exporting ) return;

			const now = performance.now();
			if ( now - lastGlow < GLOW_MIN_INTERVAL ) return;
			lastGlow = now;

			const width = overlay.clientWidth, height = overlay.clientHeight;
			if ( ! ( width > 0 ) || ! ( height > 0 ) || ! ( source.width > 0 ) ) return;

			const kx = source.width / width, ky = source.height / height;

			try {

				glowContext.drawImage( source, frame.x * kx, frame.y * ky, frame.width * kx, frame.height * ky, 0, 0, glow.width, glow.height );

			} catch ( e ) { /* a source that cannot be copied this frame just skips the glow */ }

		},

		get settings() { return { ...settings }; },
		close: closeAll

	};

	// ── small DOM helpers ────────────────────────────────────────────────────

	function el( tag, cls ) {

		const node = document.createElement( tag );
		if ( cls ) node.className = cls;
		return node;

	}

	function makeButton( cls, html, title ) {

		const button = el( 'button', 'ViewportIconButton vl-button ' + cls );
		button.type = 'button';
		button.innerHTML = html;
		button.title = title;
		button.setAttribute( 'aria-label', title );
		button.setAttribute( 'aria-haspopup', 'dialog' );
		button.setAttribute( 'aria-expanded', 'false' );
		return button;

	}

	function makePanel( label ) {

		const panel = el( 'div', 'vl-panel' );
		panel.setAttribute( 'role', 'dialog' );
		panel.setAttribute( 'aria-label', label );
		panel.hidden = true;
		const heading = el( 'div', 'vl-heading' );
		heading.textContent = label;
		panel.appendChild( heading );
		panel.body = el( 'div', 'vl-body' );
		panel.appendChild( panel.body );
		return panel;

	}

	function labelled( text, input ) {

		const label = el( 'label', 'vl-row' );
		const span = el( 'span', 'vl-label' );
		span.textContent = text;
		label.append( span, input );
		return label;

	}

	function checkbox( text, aria, onChange ) {

		const label = el( 'label', 'vl-row vl-check' );
		const input = el( 'input' );
		input.type = 'checkbox';
		input.setAttribute( 'aria-label', aria );
		input.addEventListener( 'change', () => onChange( input.checked ) );
		const span = el( 'span' );
		span.textContent = text;
		label.append( input, span );
		return { label, input };

	}

	function sliderRow( text, aria, onChange ) {

		const node = el( 'div', 'vl-row vl-slider' );
		const label = el( 'label', 'vl-check' );
		const box = el( 'input' );
		box.type = 'checkbox';
		box.setAttribute( 'aria-label', 'Enable ' + aria.toLowerCase() );
		const span = el( 'span' );
		span.textContent = text;
		label.append( box, span );

		const range = el( 'input' );
		range.type = 'range';
		range.min = '0'; range.max = '1'; range.step = '0.05';
		range.setAttribute( 'aria-label', aria + ' intensity' );

		const emit = () => onChange( box.checked, parseFloat( range.value ) );
		box.addEventListener( 'change', emit );
		range.addEventListener( 'input', function () {

			if ( ! box.checked ) box.checked = true; // moving the slider is an intent to use it
			emit();

		} );

		node.append( label, range );

		return { node, set( on, amount ) { box.checked = on; range.value = String( amount ); } };

	}

	function note( text ) {

		const p = el( 'p', 'vl-note' );
		p.textContent = text;
		return p;

	}

}

export { ViewLook };
