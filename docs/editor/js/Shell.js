import { UIPanel } from './libs/ui.js';
import { AddObjectCommand } from './commands/AddObjectCommand.js';
import { RemoveObjectCommand } from './commands/RemoveObjectCommand.js';
import { SetPositionCommand } from './commands/SetPositionCommand.js';
import { SetRotationCommand } from './commands/SetRotationCommand.js';
import { SetScaleCommand } from './commands/SetScaleCommand.js';
import { SetMaterialColorCommand } from './commands/SetMaterialColorCommand.js';
import { SetMaterialCommand } from './commands/SetMaterialCommand.js';
import { SetValueCommand } from './commands/SetValueCommand.js';
import { SetLabelCommand } from './commands/SetLabelCommand.js';
import { SetClassCommand } from './commands/SetClassCommand.js';
import { MultiCmdsCommand } from './commands/MultiCmdsCommand.js';
import { createVerifyPanel } from './import/VerifyPanel.js';
import { AI_MODELS, SYSTEM_PROMPT, SCENE_QA_PROMPT, buildSystemPrompt } from './AIPrompt.js';
import { extractCode, buildMessages, buildQAMessages, sceneContextString, addressablePartsBlock } from './AIUtils.js';
import { AIEngine, getModelList } from './AIEngine.js';
import { objectToJS, sceneToJS } from './scene/codegen.js';
import { sceneEqual } from './scene/sceneEqual.js';
import { summarizeScene as summarizeSceneFull, getSize, getTopY, getWorldCenter, searchableLabel } from './scene/summarize.js';
import { booleanUnion, booleanSubtract, booleanIntersect } from './mesh/ops/boolean.js';
import { mirrorMesh } from './mesh/ops/mirror.js';
import { arrayDuplicate } from './mesh/ops/array.js';
import { subdivide } from './mesh/ops/subdivide.js';
import { serializeForAI as opsSchema } from './mesh/ops/index.js';
import { EditModeController } from './mesh/EditModeController.js';
import { extrude }     from './mesh/ops/extrude.js';
import { inset }       from './mesh/ops/inset.js';
import { bevel }       from './mesh/ops/bevel.js';
import { deleteFaces } from './mesh/ops/delete.js';
import { weld }        from './mesh/ops/weld.js';
import { planarUV, boxUV } from './mesh/ops/uv.js';
import { SceneIntelligence, findByDescription, describeObject, listCandidates, resolvePartAI } from './intelligence/sceneIndex.js';
import { findParts } from './intelligence/sceneIndex.js';
import * as selectorEngine from './intelligence/selectorEngine.js';
import { selectorCounts } from './intelligence/vocabInjection.js';
import { buildConstrainedOpsSchema } from './intelligence/editOps.js';
import { runEditMatrix, newMatrix, recordRun, formatMatrix } from './ai/editMatrix.js';
import { colorBase as editColorBase } from './ai/editEval.js';
import { listClientModels, getClientConfig, isClientModel, makeClientEngine, openClientAPIDialog } from './ai/clientAPI.js';
import { diagnoseImport, diagnosticMessages } from './import/diagnostics.js';
import { labelImportedAsset } from './import/labelPass.js';
import { executeRecipeOp } from './intelligence/animationRecipes.js';
import { op as runOp, ops as runOps, makeQuery, OP_VOCABULARY } from './intelligence/opPrimitive.js';
import { colorToName } from './intelligence/colorName.js';
import { whatsVisible, whatsAt } from './intelligence/gpuPick.js';
import { snapshotScene, sceneDiff, confirmChange, diffSummary, inspectScene } from './intelligence/observe.js';
import { buildIndex, retrieveForPrompt, findAPI } from './ai/apiIndex.js';
import { validateCode } from './ai/validate.js';
import { runAgentic } from './ai/agentLoop.js';
import { EVAL_PROMPTS, runEval, formatTable, shouldSuggestPower } from './ai/eval.js';

// Map common shape words to the substring found in geometry.type, so findObject
// can resolve "red sphere" even when the object's name carries neither word.
const TYPE_WORDS = {
	sphere: 'sphere', ball: 'sphere',
	box: 'box', cube: 'box',
	cylinder: 'cylinder', tube: 'cylinder',
	cone: 'cone',
	plane: 'plane',
	torus: 'torus', donut: 'torus', ring: 'ring',
	capsule: 'capsule', circle: 'circle',
};



function Shell( editor ) {

	const signals = editor.signals;

	const container = new UIPanel();
	container.setId( 'shell' );
	container.setDisplay( '' );

	// ── Header bar ────────────────────────────────────────────────────────────

	const header = document.createElement( 'div' );
	header.id = 'shell-header';

	const headerTitle = document.createElement( 'span' );
	headerTitle.id = 'shell-header-title';
	headerTitle.textContent = 'JS Shell';

	const modelSelect = document.createElement( 'select' );
	modelSelect.id = 'shell-model-select';

	// Populate from WebLLM's full built-in model registry (same pattern as webllm-eg).
	// Each option shows: model_id -- X.X GB  (or MB for small models)
	function fmtVram( mb ) {

		if ( mb == null ) return '';
		if ( mb >= 1024 ) return '  \u2014  ' + ( mb / 1024 ).toFixed( 1 ) + ' GB';
		return '  \u2014  ' + Math.round( mb ) + ' MB';

	}

	// Keywords that identify code-generation models
	const CODE_KEYWORDS = [ 'coder', 'code', 'deepseek', 'starcoder', 'codellama', 'codestral' ];

	// General-purpose model families to surface alongside the coder models so the
	// user can switch between them: Phi, Gemma, Mistral, Llama.
	const MODEL_KEYWORDS = [ 'phi', 'gemma', 'mistral', 'llama' ];

	const DROPDOWN_KEYWORDS = [ ...CODE_KEYWORDS, ...MODEL_KEYWORDS ];

	// Surface the fast half-precision builds and the full-precision q4f32 builds.
	// On WebGPU the q4f32_1 variants run ~half the speed and use ~2x the memory of
	// the q4f16_1 build, so they're tagged "(slower)" in the dropdown to set
	// expectations; unquantized q0f* variants are still excluded as impractical.
	const quantTag = ( id ) => {

		const lower = id.toLowerCase();
		if ( lower.includes( 'q4f16' ) ) return '';
		if ( lower.includes( 'q4f32' ) ) return '  \u2014  (slower)';
		return null; // not an offered quantization

	};

	getModelList()
		.filter( m => DROPDOWN_KEYWORDS.some( kw => m.model_id.toLowerCase().includes( kw ) ) && quantTag( m.model_id ) !== null )
		.forEach( m => {

			const opt = document.createElement( 'option' );
			opt.value = m.model_id;
			opt.textContent = m.model_id + fmtVram( m.vram_required_MB ) + quantTag( m.model_id );
			modelSelect.appendChild( opt );

		} );

	// Load external API models (Ollama, OpenAI, Claude) if available
	( async () => {

		try {

			const res = await fetch( '/api/models' );
			const data = await res.json();

			if ( data.models && data.models.length > 0 ) {

				// Add separator for external models
				const webllmCount = modelSelect.options.length;
				if ( webllmCount > 0 ) {

					const sep = document.createElement( 'option' );
					sep.disabled = true;
					sep.textContent = '─── External APIs ───';
					modelSelect.appendChild( sep );

				}

				// Add each external model
				data.models.forEach( m => {

					// Skip WebLLM models (already in dropdown)
					if ( m.source === 'webllm' ) return;

					const opt = document.createElement( 'option' );
					opt.value = m.id;
					opt.dataset.source = m.source;  // Store the source for later
					opt.textContent = m.label;
					modelSelect.appendChild( opt );

				} );

			}

		} catch ( e ) {

			// External API check failed, silently continue with WebLLM only
			console.debug( 'External models not available', e.message );

		}

	} )();

	// ── Client-side external API models (browser → provider) ──────────────────
	// Coexists with the DEV-mode server proxy above. Adds a separator + one option
	// per configured client provider. Re-run after the config dialog saves so new
	// providers appear without a page reload.
	function refreshClientModels() {

		[ ...modelSelect.options ].forEach( o => {

			if ( o.dataset.source === 'client' || o.dataset.clientSep === '1' ) o.remove();

		} );

		const clientModels = listClientModels();
		if ( clientModels.length === 0 ) return;

		const sep = document.createElement( 'option' );
		sep.disabled = true;
		sep.dataset.clientSep = '1';
		sep.textContent = '─── Client APIs (browser) ───';
		modelSelect.appendChild( sep );

		clientModels.forEach( m => {

			const opt = document.createElement( 'option' );
			opt.value = m.value;
			opt.dataset.source = 'client';
			opt.textContent = m.label;
			modelSelect.appendChild( opt );

		} );

	}

	refreshClientModels();

	// Default to a preferred coder model if present in the list
	const PREFERRED = [
		'Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC',
		'Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC',
		'Llama-3.2-1B-Instruct-q4f32_1-MLC',
		'Llama-3.2-1B-Instruct-q4f16_1-MLC',
	];
	for ( const p of PREFERRED ) {

		const found = [ ...modelSelect.options ].find( o => o.value === p );
		if ( found ) { modelSelect.value = p; break; }

	}

	// Restore previously used model (weights already cached in browser)
	const _savedModel = localStorage.getItem( 'shell-ai-model' );
	if ( _savedModel ) modelSelect.value = _savedModel;

	const loadBtn = document.createElement( 'button' );
	loadBtn.id = 'shell-load-btn';
	loadBtn.textContent = 'Load AI';

	// Unload the current model so a different one can be loaded (switch models).
	// Hidden until a model is ready.
	const unloadBtn = document.createElement( 'button' );
	unloadBtn.id = 'shell-unload-btn';
	unloadBtn.textContent = 'Unload';
	unloadBtn.title = 'Unload the current model so you can switch to a different one';
	unloadBtn.style.display = 'none';

	// Configure a client-side external API (browser → provider). Opens a dialog to
	// add OpenAI / Anthropic / Ollama / custom endpoints; saved ones appear in the
	// model dropdown. This is independent of (and coexists with) the DEV proxy.
	const configApiBtn = document.createElement( 'button' );
	configApiBtn.id = 'shell-config-api-btn';
	configApiBtn.textContent = '⚙ API';
	configApiBtn.title = 'Configure a client-side external API (browser → provider). Coexists with the DEV-mode server proxy.';
	configApiBtn.addEventListener( 'click', () => {

		openClientAPIDialog( { onSaved: () => refreshClientModels() } );

	} );

	// ── Mutable toggle ─────────────────────────────────────────────────────────
	// When CHECKED the AI may generate + EXECUTE code and mutate the scene (the full
	// agentic path). When UNCHECKED the panel is READ-ONLY: every prompt is answered
	// Read-only mode only: AI answers questions about the scene but never executes code.
	// Generated code is shown with a "Run" button — user controls execution.
	// This eliminates the 45s mutable mode prefill delay while keeping 2s read-only speed.
	const mutableWrap = document.createElement( 'label' );
	mutableWrap.id = 'shell-mutable-wrap';
	mutableWrap.style.display = 'none';  // Hide: read-only only now

	const mutableCheckbox = document.createElement( 'input' );
	mutableCheckbox.type = 'checkbox';
	mutableCheckbox.id = 'shell-mutable-checkbox';
	mutableCheckbox.checked = false;  // Always off

	const mutableText = document.createElement( 'span' );
	mutableText.textContent = 'Mutable';

	mutableWrap.appendChild( mutableCheckbox );
	mutableWrap.appendChild( mutableText );

	const isMutable = () => false;  // Always read-only

	function updateAIPlaceholder() {

		if ( aiInput.disabled ) return;
		aiInput.placeholder = 'Ask about the scene… (Enter)';

	}

	const stopBtn = document.createElement( 'button' );
	stopBtn.id = 'shell-stop-btn';
	stopBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true"><rect width="11" height="11" rx="1.5" fill="currentColor"/></svg>';
	stopBtn.setAttribute( 'aria-label', 'Stop AI' );
	stopBtn.title = 'Stop the current AI generation';
	stopBtn.style.display = 'none';

	const clearBtn = document.createElement( 'button' );
	clearBtn.textContent = '⊖ Clear';
	clearBtn.title = 'Clear console output';
	clearBtn.style.padding = '4px 8px';
	clearBtn.style.fontSize = '12px';
	clearBtn.style.backgroundColor = 'transparent';
	clearBtn.style.border = '1px solid #555';
	clearBtn.style.color = '#999';
	clearBtn.style.borderRadius = '3px';
	clearBtn.style.cursor = 'pointer';
	clearBtn.style.marginLeft = '8px';

	const aiStatus = document.createElement( 'span' );
	aiStatus.id = 'shell-ai-status';

	header.appendChild( headerTitle );
	header.appendChild( modelSelect );
	header.appendChild( loadBtn );
	header.appendChild( unloadBtn );
	header.appendChild( configApiBtn );
	header.appendChild( mutableWrap );
	header.appendChild( clearBtn );
	container.dom.appendChild( header );

	// ── Progress bar (shown during model load) ────────────────────────────────

	const progressWrap = document.createElement( 'div' );
	progressWrap.id = 'shell-progress-wrap';
	progressWrap.style.display = 'none';

	const progressBar = document.createElement( 'div' );
	progressBar.id = 'shell-progress-bar';
	progressWrap.appendChild( progressBar );
	container.dom.appendChild( progressWrap );

	// ── Output area ───────────────────────────────────────────────────────────

	const output = document.createElement( 'div' );
	output.id = 'shell-output';
	container.dom.appendChild( output );

	// Clear button handler
	clearBtn.addEventListener( 'click', function () {
		output.innerHTML = '';
	} );

	// ── AI input row ──────────────────────────────────────────────────────────

	const aiRow = document.createElement( 'div' );
	aiRow.id = 'shell-ai-row';

	const aiPromptLabel = document.createElement( 'span' );
	aiPromptLabel.className = 'shell-prompt shell-ai-label';
	aiPromptLabel.textContent = 'AI';

	const aiInput = document.createElement( 'input' );
	aiInput.id = 'shell-ai-input';
	aiInput.type = 'text';
	aiInput.spellcheck = false;
	aiInput.autocomplete = 'off';
	aiInput.placeholder = 'Describe what to do… (Enter) — load AI model first';
	aiInput.disabled = true;

	aiRow.appendChild( aiPromptLabel );
	aiRow.appendChild( aiInput );
	aiRow.appendChild( aiStatus );
	aiRow.appendChild( stopBtn );
	container.dom.appendChild( aiRow );

	// ── JS input row ──────────────────────────────────────────────────────────

	const inputRow = document.createElement( 'div' );
	inputRow.id = 'shell-input-row';

	const prompt = document.createElement( 'span' );
	prompt.className = 'shell-prompt';
	prompt.textContent = '> ';

	const input = document.createElement( 'textarea' );
	input.id = 'shell-input';
	input.spellcheck = false;
	input.autocomplete = 'off';
	input.rows = 1;
	input.placeholder = 'Enter JS — Shift+Enter for newline, ↑↓ for history';

	inputRow.appendChild( prompt );
	inputRow.appendChild( input );
	container.dom.appendChild( inputRow );

	// ── State ─────────────────────────────────────────────────────────────────

	const history = [];
	let historyIndex = - 1;
	let savedInput = '';

	// Set true when the user clicks "Stop AI"; checked by the agentic loop so it
	// halts after the current (interrupted) generation rather than retrying.
	let aiAborted = false;

	const aiEngine = new AIEngine();

	// Expose on editor so other modules (e.g. Menubar.Git) can use the loaded engine
	editor.aiEngine = aiEngine;

	// Edit Mode controller — shared across toolbar, shell, and AI
	editor.editModeController = new EditModeController( editor );

	// Scene intelligence — derives descriptors on import, resolves NL part queries
	editor.sceneIntelligence = new SceneIntelligence( editor );

	// Route asset-import pipeline messages (normalize / diagnose / label) to the shell.
	editor.importLog = ( msg ) => appendOutput( msg, 'info' );

	// Build the local API index (Technique 2 RAG) so generation references real signatures
	buildIndex();

	// ── Helpers ───────────────────────────────────────────────────────────────

	function appendOutput( text, type ) {

		const line = document.createElement( 'div' );
		line.className = 'shell-line shell-' + type;
		line.style.display = 'flex';
		line.style.flexDirection = 'column';
		line.style.width = '100%';
		line.style.boxSizing = 'border-box';

		// Add visual separator before command lines (groups results together)
		if ( type === 'cmd' && output.children.length > 0 ) {
			line.style.marginTop = '12px';
			line.style.paddingTop = '12px';
			line.style.borderTop = '1px solid #333';
		}
		
		// Helper to decode HTML entities
		function decodeHTML( html ) {
			const txt = document.createElement( 'textarea' );
			txt.innerHTML = html;
			return txt.value;
		}
		
		// Check if this is a code result with a fenced block — format it specially
		const codeBlockMatch = String( text ).match( /```(?:js|javascript)?\n([\s\S]*?)\n```/ );
		if ( type === 'result' && codeBlockMatch && codeBlockMatch[ 1 ] ) {

			let code = decodeHTML( codeBlockMatch[ 1 ].trim() );
			const fullText = String( text );
			const beforeCode = fullText.substring( 0, fullText.indexOf( '```' ) );
			const afterCode = fullText.substring( fullText.lastIndexOf( '```' ) + 3 );

			// Render text before code block
			if ( beforeCode.trim() ) {

				const beforeDiv = document.createElement( 'div' );
				beforeDiv.innerHTML = beforeCode
					.replace( /&/g, '&amp;' )
					.replace( /</g, '&lt;' )
					.replace( />/g, '&gt;' )
					.replace( /\n/g, '<br>' );
				beforeDiv.style.marginBottom = '8px';
				line.appendChild( beforeDiv );

			}

			// Create container for code block with position: relative
			const container = document.createElement( 'div' );
			container.className = 'shell-code-block';
			container.style.width = '100%';
			container.style.minHeight = '350px';
			container.style.boxSizing = 'border-box';
			container.style.backgroundColor = '#1e1e1e';
			container.style.border = '1px solid #333';
			container.style.borderRadius = '4px';
			container.style.padding = '12px';
			container.style.fontFamily = 'Consolas, monospace';
			container.style.fontSize = '13px';
			container.style.lineHeight = '1.5';
			container.style.color = '#d4d4d4';
			container.style.marginBottom = '8px';
			container.style.display = 'flex';
			container.style.flexDirection = 'column';
			container.style.gap = '8px';
			container.style.pointerEvents = 'auto';

			// Create Monaco editor container with auto-height and word wrap
			const editorDiv = document.createElement( 'div' );
			editorDiv.style.width = '100%';
			editorDiv.style.height = 'auto';
			editorDiv.style.minHeight = '80px';
			editorDiv.style.maxHeight = '40vh';
			editorDiv.style.flex = '0 0 auto';
			editorDiv.style.display = 'block';
			editorDiv.style.boxSizing = 'border-box';
			editorDiv.style.border = '1px solid #3e3e42';
			editorDiv.style.borderRadius = '2px';
			editorDiv.style.overflow = 'hidden';
			editorDiv.style.pointerEvents = 'auto';
			editorDiv.style.backgroundColor = '#1e1e1e';

			// Append to container FIRST, before Monaco initialization
			container.appendChild( editorDiv );

			// Initialize Monaco Editor with syntax highlighting
			let monacoEditorInstance = null;
			const editorReady = new Promise( ( resolve ) => {

				require( [ 'vs/editor/editor.main' ], function () {

					monacoEditorInstance = monaco.editor.create( editorDiv, {
						value: code,
						language: 'javascript',
						lineNumbers: 'on',
						minimap: { enabled: false },
						theme: 'vs-dark',
						tabSize: 2,
						indentSize: 2,
						insertSpaces: true,
						readOnly: false,
						scrollBeyondLastLine: false,
						fontSize: 12,
						fontFamily: 'Consolas, "Courier New", monospace',
						wordWrap: 'on',
						automaticLayout: true
					} );

					// Store for later layout call after DOM insertion
					editorDiv.__monacoInstance = monacoEditorInstance;
					
					// Auto-height based on content
					function updateEditorHeight() {
						const contentHeight = Math.min( monacoEditorInstance.getContentHeight(), window.innerHeight * 0.4 );
						editorDiv.style.height = contentHeight + 'px';
						monacoEditorInstance.layout( { width: editorDiv.offsetWidth, height: contentHeight } );
					}
					
					monacoEditorInstance.onDidChangeModelContent( updateEditorHeight );
					updateEditorHeight();
					resolve();

				} );

			} );

			// Button container for Run and Fullscreen
			const btnContainer = document.createElement( 'div' );
			btnContainer.style.display = 'flex';
			btnContainer.style.gap = '8px';
			btnContainer.style.alignItems = 'flex-start';
			btnContainer.style.position = 'relative';
			btnContainer.style.zIndex = '100';
			btnContainer.style.pointerEvents = 'auto';

			// Add "Run" button
			const runBtn = document.createElement( 'button' );
			runBtn.textContent = '▶ Run';
			runBtn.style.padding = '6px 12px';
			runBtn.style.backgroundColor = '#4CAF50';
			runBtn.style.color = 'white';
			runBtn.style.border = 'none';
			runBtn.style.borderRadius = '4px';
			runBtn.style.cursor = 'pointer';
			runBtn.style.fontSize = '13px';
			runBtn.style.fontWeight = '600';
			runBtn.style.zIndex = '101';
			runBtn.style.pointerEvents = 'auto';
			runBtn.addEventListener( 'click', async function () {

				runBtn.disabled = true;
				runBtn.textContent = '⟳ running…';

				try {

					await editorReady;
					await execute( monacoEditorInstance.getValue() );
					runBtn.textContent = '✓ done';
					
					// Destroy the editor after execution
					setTimeout( () => {
						if ( monacoEditorInstance ) {
							monacoEditorInstance.dispose();
							editorDiv.innerHTML = '';
							container.remove();
						}
						runBtn.textContent = '▶ Run';
						runBtn.disabled = false;
					}, 1500 );

				} catch ( err ) {

					appendOutput( '⚠ Execution error: ' + ( err.message || err ), 'error' );
					runBtn.textContent = '▶ Run';
					runBtn.disabled = false;

				}

			} );
			btnContainer.appendChild( runBtn );

			// Add "Fullscreen" button
			const fullscreenBtn = document.createElement( 'button' );
			fullscreenBtn.textContent = '⛶ Fullscreen';
			fullscreenBtn.style.padding = '6px 12px';
			fullscreenBtn.style.backgroundColor = '#2196F3';
			fullscreenBtn.style.color = 'white';
			fullscreenBtn.style.border = 'none';
			fullscreenBtn.style.borderRadius = '4px';
			fullscreenBtn.style.cursor = 'pointer';
			fullscreenBtn.style.fontSize = '13px';
			fullscreenBtn.style.fontWeight = '600';
			fullscreenBtn.style.zIndex = '101';
			fullscreenBtn.style.pointerEvents = 'auto';
			fullscreenBtn.addEventListener( 'click', async function () {

				await editorReady;

				// Create fullscreen overlay
				const overlay = document.createElement( 'div' );
				overlay.style.position = 'fixed';
				overlay.style.top = '0';
				overlay.style.left = '0';
				overlay.style.width = '100%';
				overlay.style.height = '100%';
				overlay.style.backgroundColor = '#1e1e1e';
				overlay.style.zIndex = '10000';
				overlay.style.display = 'flex';
				overlay.style.flexDirection = 'column';
				overlay.style.padding = '20px';
				overlay.style.boxSizing = 'border-box';

				// Close button
				const closeBtn = document.createElement( 'button' );
				closeBtn.textContent = '✕ Close';
				closeBtn.style.alignSelf = 'flex-end';
				closeBtn.style.marginBottom = '12px';
				closeBtn.style.padding = '8px 16px';
				closeBtn.style.backgroundColor = '#f44336';
				closeBtn.style.color = 'white';
				closeBtn.style.border = 'none';
				closeBtn.style.borderRadius = '4px';
				closeBtn.style.cursor = 'pointer';
				closeBtn.style.fontSize = '14px';
				closeBtn.style.fontWeight = '600';
				closeBtn.addEventListener( 'click', function () {
					overlay.remove();
				} );
				overlay.appendChild( closeBtn );

				// Full-size editor container
				const fullEditorDiv = document.createElement( 'div' );
				fullEditorDiv.style.flex = '1';
				fullEditorDiv.style.overflow = 'hidden';

				// Create another Monaco instance for fullscreen
				require( [ 'vs/editor/editor.main' ], function () {

					const fullEditor = monaco.editor.create( fullEditorDiv, {
						value: monacoEditorInstance.getValue(),
						language: 'javascript',
						lineNumbers: 'on',
						minimap: { enabled: false },
						theme: 'vs-dark',
						tabSize: 2,
						indentSize: 2,
						insertSpaces: true,
						readOnly: false,
						scrollBeyondLastLine: false,
						fontSize: 12,
						fontFamily: 'Consolas, "Courier New", monospace'
					} );

					// Sync changes back to main editor on close
					closeBtn.addEventListener( 'click', function () {
						monacoEditorInstance.getModel().setValue( fullEditor.getValue() );
						overlay.remove();
					} );

					fullEditor.focus();
					fullEditor.layout();

				} );

				overlay.appendChild( fullEditorDiv );
				document.body.appendChild( overlay );

			} );
			btnContainer.appendChild( fullscreenBtn );
			container.appendChild( btnContainer );
			line.appendChild( container );
			
			// Layout Monaco AFTER adding to DOM
			requestAnimationFrame( () => {
				if ( editorDiv.__monacoInstance ) {
					editorDiv.__monacoInstance.layout();
				}
			} );

			// Render text after code block
			if ( afterCode.trim() ) {

				const afterDiv = document.createElement( 'div' );
				afterDiv.innerHTML = afterCode
					.replace( /&/g, '&amp;' )
					.replace( /</g, '&lt;' )
					.replace( />/g, '&gt;' )
					.replace( /\n/g, '<br>' );
				afterDiv.style.marginTop = '8px';
				line.appendChild( afterDiv );

			}

		} else {

			// Non-code result — display normally
			line.innerHTML = String( text )
				.replace( /&/g, '&amp;' )
				.replace( /</g, '&lt;' )
				.replace( />/g, '&gt;' )
				.replace( /\n/g, '<br>' );

			// Click copies the raw text to clipboard
			line.addEventListener( 'click', function () {

				navigator.clipboard.writeText( text ).then( function () {

					line.classList.add( 'shell-copied' );
					setTimeout( () => line.classList.remove( 'shell-copied' ), 600 );

				} );

			} );

		}

		output.appendChild( line );
		scrollToBottom();

	}

	// Pin the console to the latest output. Runs after layout so the freshly
	// appended line is measured before we scroll.
	function scrollToBottom() {

		output.scrollTop = output.scrollHeight;
		requestAnimationFrame( () => { output.scrollTop = output.scrollHeight; } );

	}

	// Registers a finished AnimationClip on an object (default: scene). Shared by
	// the addClip / addSpinClip sandbox helpers — defined here (closure scope) so
	// neither relies on `this`, which is unbound when helpers are called bare.
	function registerAnimationClip( object, clip ) {

		const target = ( object && object.isObject3D ) ? object : editor.scene;
		// THREE.AnimationClip has no `isAnimationClip` flag, so validate by SHAPE:
		// a valid AnimationClip must have tracks[] and a numeric duration property.
		// This duck-type check works across all THREE versions and edge cases.
		const isClip = clip && Array.isArray( clip.tracks ) && typeof clip.duration === 'number';
		if ( ! isClip ) throw new Error( 'addClip: second arg must be an AnimationClip' );
		if ( ! Array.isArray( target.animations ) ) target.animations = [];
		target.animations.push( clip );
		if ( editor.mixer ) editor.mixer.uncacheRoot( target );

		if ( target !== editor.scene ) {

			editor.select( target );

		} else {

			editor.signals.objectSelected.dispatch( editor.scene );

		}

		appendOutput( 'Added clip "' + ( clip.name || 'Clip' ) + '" (' + clip.tracks.length + ' track' + ( clip.tracks.length === 1 ? '' : 's' ) + ', ' + ( clip.duration >= 0 ? clip.duration.toFixed( 2 ) + 's' : 'auto' ) + ') — open the Animations tab to play it.', 'result' );
		return clip;

	}

	function formatValue( val ) {

		if ( val === null ) return 'null';
		if ( val === undefined ) return 'undefined';
		if ( typeof val === 'function' ) return val.toString().split( '\n' )[ 0 ] + ' … }';
		if ( typeof val === 'object' ) {

			try { return JSON.stringify( val, null, 2 ); } catch { return String( val ); }

		}
		return String( val );

	}

	// ── Single execution surface ──────────────────────────────────────────────
	// Both human keystrokes and AI output call this function.
	// Binding: new Function('__s__','__c__','with(__s__){return eval(__c__)}')(scope, code)

	function execute( code, opts = {} ) {

		const quiet = opts.quiet === true; // eval fixtures run silently (no echo/history/result)

		code = code.trim();
		if ( ! code ) return;

		// `help` (typed bare or called) prints the command reference.
		if ( code === 'help' || code === 'help()' ) {

			appendOutput( '> ' + code, 'cmd' );
			printHelp();
			return;

		}

		if ( ! quiet ) {

			history.unshift( code );
			if ( history.length > 500 ) history.pop();
			historyIndex = - 1;
			savedInput = '';

			appendOutput( '> ' + code, 'cmd' );

		}

		try {

			// Scope vars become named parameters of a new Function; direct eval()
			// inside that function reliably sees all parameters as local variables.
			const query = makeQuery( editor ); // shared selector-picker ($S, Pick, pick)
			
			// Capture scene state before execution
			const childrenCountBefore = editor.scene.children.length;
			const historyCmdCountBefore = editor.history.undos.length;
			
			const scope = {
				editor,
				THREE:   window.THREE,
				get scene()    { return editor.scene; },
				get camera()   { return editor.camera; },
				get renderer() { return editor.renderer; },
				AddObjectCommand,
				RemoveObjectCommand,
				SetPositionCommand,
				SetRotationCommand,
				SetScaleCommand,
				SetMaterialColorCommand,
				SetMaterialCommand,
				SetValueCommand,
				// three.js primitives — available without THREE. prefix
				BoxGeometry:          window.THREE.BoxGeometry,
				SphereGeometry:       window.THREE.SphereGeometry,
				CylinderGeometry:     window.THREE.CylinderGeometry,
				ConeGeometry:         window.THREE.ConeGeometry,
				PlaneGeometry:        window.THREE.PlaneGeometry,
				TorusGeometry:        window.THREE.TorusGeometry,
				TorusKnotGeometry:    window.THREE.TorusKnotGeometry,
				CircleGeometry:       window.THREE.CircleGeometry,
				MeshStandardMaterial: window.THREE.MeshStandardMaterial,
				MeshBasicMaterial:    window.THREE.MeshBasicMaterial,
				MeshPhongMaterial:    window.THREE.MeshPhongMaterial,
				MeshLambertMaterial:  window.THREE.MeshLambertMaterial,
				LineBasicMaterial:    window.THREE.LineBasicMaterial,
				Mesh:                 window.THREE.Mesh,
				Group:                window.THREE.Group,
				Line:                 window.THREE.Line,
				Points:               window.THREE.Points,
				DirectionalLight:     window.THREE.DirectionalLight,
				PointLight:           window.THREE.PointLight,
				AmbientLight:         window.THREE.AmbientLight,
				SpotLight:            window.THREE.SpotLight,
				Color:                window.THREE.Color,
				Vector3:              window.THREE.Vector3,
				Vector2:              window.THREE.Vector2,
				Euler:                window.THREE.Euler,

				// ── Extended geometry ──────────────────────────────────────────────────
				LatheGeometry:        window.THREE.LatheGeometry,
				TubeGeometry:         window.THREE.TubeGeometry,
				CapsuleGeometry:      window.THREE.CapsuleGeometry,
				ExtrudeGeometry:      window.THREE.ExtrudeGeometry,
				ShapeGeometry:        window.THREE.ShapeGeometry,
				Shape:                window.THREE.Shape,
				Path:                 window.THREE.Path,
				CatmullRomCurve3:     window.THREE.CatmullRomCurve3,
				QuadraticBezierCurve3: window.THREE.QuadraticBezierCurve3,
				CubicBezierCurve3:    window.THREE.CubicBezierCurve3,

				// ── Keyframe animation ─────────────────────────────────────────────────
				// Build clips with these tracks, then register with addClip(object, clip).
				AnimationClip:           window.THREE.AnimationClip,
				VectorKeyframeTrack:     window.THREE.VectorKeyframeTrack,
				QuaternionKeyframeTrack: window.THREE.QuaternionKeyframeTrack,
				NumberKeyframeTrack:     window.THREE.NumberKeyframeTrack,
				ColorKeyframeTrack:      window.THREE.ColorKeyframeTrack,
				BooleanKeyframeTrack:    window.THREE.BooleanKeyframeTrack,
				Quaternion:              window.THREE.Quaternion,

				// ── PBR materials ──────────────────────────────────────────────────────
				MeshPhysicalMaterial: window.THREE.MeshPhysicalMaterial,

				// ── Procedural texture helpers ─────────────────────────────────────────
				// makeTexture(fn, size) — fn(ctx, size) draws on a 2D canvas; returns CanvasTexture
				makeTexture: ( fn, size = 256 ) => {

					const c = document.createElement( 'canvas' );
					c.width = c.height = size;
					fn( c.getContext( '2d' ), size );
					const tex = new window.THREE.CanvasTexture( c );
					tex.wrapS = tex.wrapT = window.THREE.RepeatWrapping;
					return tex;

				},

				// makeCheckerTex(size, dark, light, tiles) — checker board texture
				// color args accept 0xRRGGBB numbers or CSS strings
				makeCheckerTex: ( size = 256, dark = 0x111111, light = 0xeeeeee, tiles = 8 ) => {

					const toCSS = v => typeof v === 'number' ? '#' + v.toString( 16 ).padStart( 6, '0' ) : v;
					const c = document.createElement( 'canvas' );
					c.width = c.height = size;
					const ctx = c.getContext( '2d' );
					const s = size / tiles;

					for ( let y = 0; y < tiles; y ++ ) {

						for ( let x = 0; x < tiles; x ++ ) {

							ctx.fillStyle = ( x + y ) % 2 === 0 ? toCSS( dark ) : toCSS( light );
							ctx.fillRect( x * s, y * s, s, s );

						}

					}

					const tex = new window.THREE.CanvasTexture( c );
					tex.wrapS = tex.wrapT = window.THREE.RepeatWrapping;
					return tex;

				},

				// makeGridTex(size, lineColor, divisions, bgColor) — grid lines texture
				makeGridTex: ( size = 256, lineColor = 0xffffff, divisions = 8, bgColor = 0x111111 ) => {

					const toCSS = v => typeof v === 'number' ? '#' + v.toString( 16 ).padStart( 6, '0' ) : v;
					const c = document.createElement( 'canvas' );
					c.width = c.height = size;
					const ctx = c.getContext( '2d' );
					ctx.fillStyle = toCSS( bgColor );
					ctx.fillRect( 0, 0, size, size );
					ctx.strokeStyle = toCSS( lineColor );
					ctx.lineWidth = 1;
					const step = size / divisions;

					for ( let i = 0; i <= divisions; i ++ ) {

						ctx.beginPath(); ctx.moveTo( i * step, 0 );      ctx.lineTo( i * step, size ); ctx.stroke();
						ctx.beginPath(); ctx.moveTo( 0,         i * step ); ctx.lineTo( size,    i * step ); ctx.stroke();

					}

					const tex = new window.THREE.CanvasTexture( c );
					tex.wrapS = tex.wrapT = window.THREE.RepeatWrapping;
					return tex;

				},

				// ── Codegen / round-trip helpers ───────────────────────────────────────
				// showJS()  — generate + print JS for the selected object (or full scene)
				showJS: function ( target ) {

					const obj = target ?? editor.selected;

					if ( ! obj ) {

						const result = sceneToJS( editor );
						appendOutput( result.code, 'result' );
						if ( result.lossy ) appendOutput( '⚠ Lossy fallback used: ' + result.lossyReasons.join( '; ' ), 'error' );
						return result;

					}

					const result = objectToJS( obj );
					appendOutput( result.code, 'result' );
					if ( result.lossy ) appendOutput( '⚠ Lossy fallback used: ' + result.lossyReasons.join( '; ' ), 'error' );
					return result;

				},
				objectToJS,
				sceneToJS:  () => sceneToJS( editor ),
				sceneEqual,
				summarize:  () => summarizeSceneFull( editor ),

				// ── Scene object lookup ────────────────────────────────────────────────
				// findObject(query) — best-matching object, scored across NAME, material
				// COLOR, and geometry TYPE in one pass. So "green cube" picks the right
				// cube AND "red sphere" resolves even when the name carries neither word
				// (color is on the material, shape is in geometry.type).
				// Weights: exact name ≫ whole-phrase name > geometry type > color > name word.
				findObject: function ( query ) {

					if ( ! query ) return editor.selected;
					const q = String( query ).toLowerCase().trim();
					const words = q.split( /\s+/ ).filter( Boolean );

					let exact = null;
					let best = null, bestScore = 0;

					editor.scene.traverse( function ( obj ) {

						// Decoded node name + material name(s) — matches GLB parts whose
						// only meaningful label is the material ("Tail Light" on "Object_12").
						const name = searchableLabel( obj );
						let score = 0;

						if ( name ) {

							if ( ! exact && name === q ) exact = obj;
							if ( name.includes( q ) ) score += 100 + q.length;   // whole phrase
							else for ( const w of words ) if ( name.includes( w ) ) score += 8;

						}

						if ( obj.isMesh ) {

							// Geometry type ("sphere" → SphereGeometry)
							const gtype = ( obj.geometry && obj.geometry.type || '' ).toLowerCase();
							for ( const w of words ) {

								const hint = TYPE_WORDS[ w ];
								if ( hint && gtype.includes( hint ) ) score += 12;

							}

							// Material color name ("red" → red material)
							const mat = Array.isArray( obj.material ) ? obj.material[ 0 ] : obj.material;
							if ( mat && mat.color ) {

								const base = colorToName( mat.color ).base;
								for ( const w of words ) {

									if ( w === base || ( w === 'grey' && base === 'gray' ) ) score += 6;

								}

							}

						}

						if ( score > bestScore ) { bestScore = score; best = obj; }

					} );

					return exact || ( bestScore > 0 ? best : null );

				},

				// findAll(query) — every object whose name contains query
				findAll: function ( query ) {

					const q   = String( query ).toLowerCase().trim();
					const out = [];

					editor.scene.traverse( function ( obj ) {

						if ( ( obj.name || '' ).toLowerCase().includes( q ) ) out.push( obj );

					} );

					return out;

				},

				// findOfType(type) — first object of a given three.js type string
				// e.g. findOfType('Mesh'), findOfType('DirectionalLight'), findOfType('Group')
				findOfType: function ( type ) {

					const t = String( type ).toLowerCase();
					let found = null;

					editor.scene.traverse( function ( obj ) {

						if ( ! found && obj.type.toLowerCase() === t ) found = obj;

					} );

					return found;

				},

				// findNear(mesh, radius) — all scene objects within radius of mesh's world position
				findNear: function ( mesh, radius ) {

					if ( ! mesh || ! mesh.position ) throw new Error( 'findNear: first arg must be an Object3D' );
					const r2 = radius * radius;
					const out = [];

					editor.scene.traverse( function ( obj ) {

						if ( obj === mesh ) return;
						if ( obj.position.distanceToSquared( mesh.position ) <= r2 ) out.push( obj );

					} );

					return out;

				},

				// ── Scene intelligence — natural-language part resolution ─────────────
				// Deterministic geometry+color+symmetry descriptors; ambiguous cases
				// can be disambiguated by the loaded LLM via resolvePartAI (async).

				// findByDescription(text) — best node for a NL part reference (sync, free).
				// Returns the node directly when confident, else logs candidates and
				// returns the top node (check .userData for confidence via describeObject).
				findByDescription: function ( text ) {

					const r = findByDescription( editor, text );

					if ( r.labeling ) { appendOutput( '🏷 No part labels yet — labeling this asset now. Re-run your command in a few seconds.', 'info' ); return null; }
					if ( r.method === 'merged' ) { appendOutput( 'ℹ ' + r.message, 'info' ); return null; }
					if ( r.method === 'none' )   { appendOutput( 'ℹ No node matched: "' + text + '"', 'info' ); return null; }

					if ( r.method === 'ambiguous' ) {

						appendOutput( '⚠ Ambiguous — candidates: ' + r.candidates.map( c => ( c.node.name || c.node.uuid.slice( 0, 6 ) ) + ' (' + c.reasons.join( '+' ) + ')' ).join( ', ' ), 'info' );

					}

					return r.node;

				},

				// describeObject(node) — derived descriptor bundle (region/shape/color/pair)
				describeObject: ( node ) => describeObject( editor, node ?? editor.selected ),

				// listCandidates(text) — ranked candidates [{node, score, reasons}]
				listCandidates: ( text ) => listCandidates( editor, text ),

				// resolvePartAI(text) — async Path A + LLM disambiguation → {node, confidence, method}
				resolvePartAI: ( text ) => resolvePartAI( editor, text ),

				// findParts(text) — PLURAL part resolution → ARRAY of meshes for a
				// subset of an imported asset ("the wheels"). Use this to edit only the
				// named parts instead of traversing/recoloring the whole object.
				findParts: function ( text ) {

					const r = findParts( editor, text );
					if ( r.labeling ) { appendOutput( '🏷 No part labels yet — labeling this asset now. Re-run your command in a few seconds.', 'info' ); return []; }
					if ( r.method === 'merged' ) { appendOutput( 'ℹ ' + r.message, 'info' ); return []; }
					if ( r.nodes.length === 0 ) { appendOutput( 'ℹ No parts matched: "' + text + '"', 'info' ); return []; }
					if ( r.method === 'descriptors' && r.ambiguous ) { appendOutput( '⚠ No labels for this asset — best-guessing one part for "' + text + '".', 'info' ); }
					return r.nodes;

				},

				// diagnoseImport(obj) — structural facts about an imported asset
				// (merged-mesh? opaque names? textured?), with safe user-facing notes.
				diagnoseImport: function ( obj ) {

					const root = obj ?? editor.selected;
					if ( ! root ) { appendOutput( 'ℹ Select or pass an imported object.', 'info' ); return null; }
					const d = diagnoseImport( root );
					for ( const m of diagnosticMessages( d, root.name || 'asset' ) ) appendOutput( 'ℹ ' + m, 'info' );
					return d;

				},

				// relabelAsset(obj) — re-run the LLM labeling pass (Stage 4) on demand.
				relabelAsset: ( obj ) => labelImportedAsset( editor, obj ?? editor.selected, { force: true } ),

				// verifyImport(obj?) — open the Import+Verify panel (M7): symmetric
				// families collapsed to one row ("Wheel ×4"), low-confidence first,
				// Apply writes family labels in ONE undo. Also opens automatically
				// after an asset is imported+labeled. Reflected in the next AI request.
				verifyImport: ( obj ) => openVerifyPanel( obj ?? editor.selected, { resolve: true } ),

				// ── User-curated labels/classes (verify-edit path) ────────────────────
				// These write the fields BOTH the selector engine AND the injected
				// ADDRESSABLE PARTS list read (userData.label / userData.customClasses),
				// command-backed (undoable). Because the prompt recomputes per request,
				// edits are reflected in the next AI request automatically.

				// relabel(obj?, 'wheel') — rename a part's semantic label (→ #wheel).
				relabel: ( obj, label ) => {

					if ( label === undefined && typeof obj === 'string' ) { label = obj; obj = undefined; }
					const node = obj ?? editor.selected;
					if ( ! node ) { appendOutput( 'relabel: select or pass an object.', 'info' ); return null; }
					if ( typeof label !== 'string' || ! label.trim() ) { appendOutput( 'relabel: pass a label string.', 'info' ); return null; }
					editor.execute( new SetLabelCommand( editor, node, label.trim() ) );
					appendOutput( `Labeled "${ node.name || node.uuid.slice( 0, 6 ) }" → "${ label.trim() }" (now addressable; reflected in the next AI request).`, 'result' );
					return node;

				},

				// tagClass(obj?, 'wheel') / untagClass(obj?, 'wheel') — add/remove a
				// semantic class (→ .wheel). obj defaults to the selection.
				tagClass: ( obj, cls ) => {

					if ( cls === undefined && typeof obj === 'string' ) { cls = obj; obj = undefined; }
					const node = obj ?? editor.selected;
					if ( ! node || typeof cls !== 'string' || ! cls.trim() ) { appendOutput( 'tagClass(obj?, "class")', 'info' ); return null; }
					editor.execute( new SetClassCommand( editor, node, cls.trim(), true ) );
					appendOutput( `Tagged "${ node.name || 'node' }" .${ cls.trim() }`, 'result' );
					return node;

				},
				untagClass: ( obj, cls ) => {

					if ( cls === undefined && typeof obj === 'string' ) { cls = obj; obj = undefined; }
					const node = obj ?? editor.selected;
					if ( ! node || typeof cls !== 'string' || ! cls.trim() ) { appendOutput( 'untagClass(obj?, "class")', 'info' ); return null; }
					editor.execute( new SetClassCommand( editor, node, cls.trim(), false ) );
					appendOutput( `Untagged "${ node.name || 'node' }" .${ cls.trim() }`, 'result' );
					return node;

				},

				// ── Selector-based part addressing (CSS-like grammar over scene graph) ──
				// Selectors: #id (unique label), .class, type, .a.b (compound),
				// A B (descendant), A > B (child), * (wildcard).
				// Example: query(scene, '.wheel.front') → all front wheels
				query: ( selector ) => {

					if ( typeof selector !== 'string' ) throw new Error( 'query: arg must be a selector string' );
					return selectorEngine.query( editor.scene, selector );

				},

				// queryOne(selector) — return first match or null
				queryOne: ( selector ) => {

					if ( typeof selector !== 'string' ) throw new Error( 'queryOne: arg must be a selector string' );
					const results = selectorEngine.query( editor.scene, selector );
					return results.length > 0 ? results[ 0 ] : null;

				},

				// isValidSelector(selector) — check syntax without matching
				isValidSelector: ( selector ) => selectorEngine.isValid( selector ),

				// listSelectors() — the ACTUAL addressable selectors in the current
				// scene, with counts (e.g. ".tire(×4)  #dump-bed  .red(×3)"). Use this
				// to discover what parts are called instead of guessing ".wheel". A
				// selector matching nothing means that label/class isn't in the scene —
				// run relabelAsset() if the import labeling pass hasn't tagged parts yet.
				listSelectors: () => {

					const counts = selectorCounts( editor.scene );
					if ( counts.length === 0 ) {

						appendOutput( 'No addressable selectors yet. Import an asset, or run relabelAsset() to label parts.', 'info' );
						return [];

					}
					const line = counts.map( ( { selector, count } ) => count > 1 ? `${ selector }(×${ count })` : selector ).join( '  ' );
					appendOutput( 'Addressable parts: ' + line, 'result' );
					return counts;

				},

				// ── op-JSON primitive + $S chainable API (the unified edit surface) ──
				// op({type, selector, ...args}) — execute ONE structured op (command-backed,
				// guarded, undoable). Closed set: recolor scale move rotate delete duplicate
				// retexture setMaterial spin bounce pulse fade orbit shake raw.
				op: ( opJSON ) => runOp( editor, opJSON ),
				// ops([...]) — execute a list of ops in sequence (multi-op decomposition).
				ops: ( opList ) => runOps( editor, opList ),
				// $S(selector) — jQuery-style chainable set; named methods are 3D ops.
				// Example: $S('.wheel').recolor('#111').spin('y', 1)
				// Aliases: Pick, pick — the same selector-picking function.
				$S: query,
				Pick: query,
				pick: query,
				// OP_VOCABULARY — the closed op set + typed args (for introspection).
				OP_VOCABULARY,

				// ── Agentic grounding tools (no vision model) ─────────────────────────
				// findAPI(text) — retrieve REAL API signatures (anti-hallucination)
				findAPI: ( text ) => findAPI( text ).map( h => h.sig ).join( '\n' ),
				// whatsVisible() — GPU color-pick: on-screen objects by coverage
				whatsVisible: () => whatsVisible( editor ),
				// whatsAt(x,y) — GPU color-pick: object under a viewport pixel
				whatsAt: ( x, y ) => whatsAt( editor, x, y ),

				// ── Modeling ops (M1/M2) — same surface for UI and AI ─────────────────
				// Closures capture `editor` so the AI can call them without it.

				booleanUnion:     ( meshA, meshB, keepInputs )            => booleanUnion( editor, meshA, meshB, keepInputs ),
				booleanSubtract:  ( meshA, meshB, keepInputs )            => booleanSubtract( editor, meshA, meshB, keepInputs ),
				booleanIntersect: ( meshA, meshB, keepInputs )            => booleanIntersect( editor, meshA, meshB, keepInputs ),
				mirrorMesh:       ( mesh, axis )                          => mirrorMesh( editor, mesh, axis ),
				arrayDuplicate:   ( mesh, count, ox, oy, oz )             => arrayDuplicate( editor, mesh, count, ox, oy, oz ),
				subdivide:        ( mesh, iterations )                    => subdivide( editor, mesh, iterations ),

				// Diagnostic: print the registered op schema
				listOps: () => opsSchema(),

				// ── Edit Mode ops ────────────────────────────────────────────────────
				// Enter Edit Mode: Tab key, or enterEditMode(). Exit: Tab or exitEditMode().
				// Keys: 1=vertex 2=edge 3=face  A=select all/none

				enterEditMode: ( mesh ) => editor.editModeController.enter( mesh ?? editor.selected ),
				exitEditMode:  ()       => editor.editModeController.exit(),

				extrude:     ( distance = 1 )    => editor.editModeController.runOp( ( em, sel ) => extrude( em, sel, { distance } ),    'extrude',     { distance } ),
				inset:       ( amount = 0.2 )    => editor.editModeController.runOp( ( em, sel ) => inset( em, sel, { amount } ),       'inset',       { amount } ),
				bevel:       ( amount = 0.1 )    => editor.editModeController.runOp( ( em, sel ) => bevel( em, sel, { amount } ),       'bevel',       { amount } ),
				deleteFaces: ()                  => editor.editModeController.runOp( ( em, sel ) => deleteFaces( em, sel ),              'deleteFaces', {} ),
				weld:        ( threshold = 0.01 )=> editor.editModeController.runOp( ( em, sel ) => weld( em, sel, { threshold } ),     'weld',        { threshold } ),
				planarUV:    ( axis = 'y' )      => editor.editModeController.runOp( ( em, sel ) => planarUV( em, sel, axis ),          'planarUV',    { axis } ),
				boxUV:       ()                  => editor.editModeController.runOp( ( em, sel ) => boxUV( em, sel ),                   'boxUV',       {} ),

				// ── Selection helpers (used directly and in recipe-replayed code) ────────
				selectFaces:    ( ...ids ) => { const emc = editor.editModeController; if ( emc.active ) { emc.selection.setMode( 'face' ); ids.forEach( id => emc.selection.add( id ) ); emc.updateOverlay(); } },
				selectVertices: ( ...ids ) => { const emc = editor.editModeController; if ( emc.active ) { emc.selection.setMode( 'vertex' ); ids.forEach( id => emc.selection.add( id ) ); emc.updateOverlay(); } },
				selectEdges:    ( ...ids ) => { const emc = editor.editModeController; if ( emc.active ) { emc.selection.setMode( 'edge' ); ids.forEach( id => emc.selection.add( id ) ); emc.updateOverlay(); } },
				clearSelection: ()         => { const emc = editor.editModeController; if ( emc.active ) { emc.selection.clear(); emc.updateOverlay(); } },

				// ── Selection criteria (M6) ──────────────────────────────────────────────
				// Programmatic selection for AI-driven modeling
				selectTopFaces: ( count = 1 ) => {
					const emc = editor.editModeController;
					if ( ! emc.active ) return;
					emc.selection.setMode( 'face' );
					emc.selection.clear();
					const em = emc.em;
					const faces = em.faces.filter( f => f ).map( f => ( {
						id: f.id,
						centerY: em.faceCenter( f.id ).y,
					} ) ).sort( ( a, b ) => b.centerY - a.centerY ).slice( 0, count );
					faces.forEach( f => emc.selection.add( f.id ) );
					emc.updateOverlay();
				},
				selectFacingUp: ( threshold = 0.1 ) => {
					const emc = editor.editModeController;
					if ( ! emc.active ) return;
					emc.selection.setMode( 'face' );
					emc.selection.clear();
					const em = emc.em;
					em.faces.forEach( f => {
						if ( f ) {
							const n = em.faceNormal( f.id );
							if ( n.y >= threshold ) emc.selection.add( f.id );
						}
					} );
					emc.updateOverlay();
				},
				selectBoundaryEdges: () => {
					const emc = editor.editModeController;
					if ( ! emc.active ) return;
					emc.selection.setMode( 'edge' );
					emc.selection.clear();
					const em = emc.em;
					em.halfEdges.forEach( he => {
						if ( he.twin === - 1 ) emc.selection.add( Math.min( he.id, he.id ) );
					} );
					emc.updateOverlay();
				},

				// ── Spatial helpers ───────────────────────────────────────────────────
				// These are the correct way to reason about world-space dimensions;
				// reading raw geometry params ignores scale transforms.

				// {x,y,z} world-space bounding box size of any Object3D
				getSize: ( obj ) => getSize( obj ),

				// Y coordinate of the top face in world space — use for "place on top of"
				getTopY: ( obj ) => getTopY( obj ),

				// World-space center point of an Object3D's bounding box
				getCenter: ( obj ) => getWorldCenter( obj ),

				// Move `child` so it rests on top of `target` (no overlap)
				placeOnTop: function ( child, target ) {

					if ( ! child || ! target ) throw new Error( 'placeOnTop: two Object3D args required' );
					const halfH   = getSize( child ).y / 2;
					const topY    = getTopY( target );
					child.position.y = topY + halfH;

				},

				// lineFromPoints(points, color) → a Line through the given points.
				// Hides the BufferGeometry/LineBasicMaterial plumbing (neither is a
				// shell global) so nets / wires / paths have one blessed, working path.
				// points: array of Vector3 or [x,y,z] triples. Returns the Line (unadded).
				lineFromPoints: function ( points, color = 0xffffff ) {

					const T = window.THREE;
					const pts = ( points || [] ).map( p => p && p.isVector3 ? p : new T.Vector3( p[ 0 ], p[ 1 ], p[ 2 ] ) );
					if ( pts.length < 2 ) throw new Error( 'lineFromPoints: need at least 2 points' );
					const geom = new T.BufferGeometry().setFromPoints( pts );
					return new T.Line( geom, new T.LineBasicMaterial( { color } ) );

				},

				// addClip(object, clip) — register a finished AnimationClip on `object`
				// (defaults to the scene) so it shows up in the Animations panel and can
				// be played. Track names MUST be "<object.uuid>.<property>" (position /
				// scale → VectorKeyframeTrack[3], quaternion → QuaternionKeyframeTrack[4]).
				// Selects the animated object so the new clip is visible. Returns the clip.
				addClip: function ( object, clip ) {

					return registerAnimationClip( object, clip );

				},

				// addSpinClip(object, opts) — register a rotation animation that works for
				// FULL turns. A 2-keyframe quaternion track CAN'T express a 360° spin
				// because 0 and 2π map to antipodal quaternions (same orientation), so
				// slerp interpolates ~nothing. This sub-divides the turn into ≤90° steps
				// so each slerp segment goes the intended way and a full spin accumulates.
				// opts: { axis:'y', turns:1, seconds:8, pingPong:true, name }.
				// pingPong:true rotates out and back to the start (default); false = one way.
				addSpinClip: function ( object, opts = {} ) {

					const T = window.THREE;
					const target = ( object && object.isObject3D ) ? object : editor.scene;
					const axis = ( opts.axis || 'y' ).toLowerCase();
					const turns = opts.turns ?? 1;
					const seconds = opts.seconds ?? opts.duration ?? 8;
					const pingPong = opts.pingPong !== false;
					const name = opts.name || ( 'Spin ' + axis.toUpperCase() );

					const axisVec = new T.Vector3( axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0 );
					const total = turns * Math.PI * 2;

					// Forward sweep of angles in ≤90° steps, mirrored back for ping-pong.
					const segments = Math.max( 1, Math.ceil( Math.abs( turns ) * 4 ) );
					const angles = [];
					for ( let i = 0; i <= segments; i ++ ) angles.push( ( total * i ) / segments );
					if ( pingPong ) for ( let i = segments - 1; i >= 0; i -- ) angles.push( ( total * i ) / segments );

					const baseQ = target.quaternion.clone();
					const tmpQ = new T.Quaternion();
					const times = [], values = [];
					const last = angles.length - 1;

					for ( let i = 0; i < angles.length; i ++ ) {

						times.push( ( seconds * i ) / last );
						tmpQ.setFromAxisAngle( axisVec, angles[ i ] ).premultiply( baseQ );
						values.push( tmpQ.x, tmpQ.y, tmpQ.z, tmpQ.w );

					}

					const track = new T.QuaternionKeyframeTrack( target.uuid + '.quaternion', times, values );
					return registerAnimationClip( target, new T.AnimationClip( name, - 1, [ track ] ) );

				},

				// makeTable(opts) → a complete, legged table Group (top + 4 corner legs),
				// correctly proportioned. Returns the Group (unadded) — add it with
				// AddObjectCommand. Hand-building furniture keeps dropping the legs; this
				// is the blessed path. opts: { position:[x,y,z]|Vector3, width=3, depth=2,
				// height=0.75, topColor, legColor, name }.
				makeTable: function ( opts = {} ) {

					const T = window.THREE;
					const w = opts.width ?? 3, d = opts.depth ?? 2, h = opts.height ?? 0.75;
					const topT = 0.1, legW = 0.1;
					const group = new T.Group();
					group.name = opts.name ?? 'Table';

					const topMat = new T.MeshStandardMaterial( { color: opts.topColor ?? 0x654321, roughness: 0.7, metalness: 0 } );
					const legMat = new T.MeshStandardMaterial( { color: opts.legColor ?? 0x3d2817, roughness: 0.8, metalness: 0 } );

					const top = new T.Mesh( new T.BoxGeometry( w, topT, d ), topMat );
					top.position.set( 0, h - topT / 2, 0 );
					top.name = 'Top';
					group.add( top );

					const legH = h - topT, lx = w / 2 - legW, lz = d / 2 - legW;
					[ [ - lx, - lz ], [ lx, - lz ], [ - lx, lz ], [ lx, lz ] ].forEach( ( c, i ) => {

						const leg = new T.Mesh( new T.BoxGeometry( legW, legH, legW ), legMat );
						leg.position.set( c[ 0 ], legH / 2, c[ 1 ] );
						leg.name = 'Leg ' + ( i + 1 );
						group.add( leg );

					} );

					if ( opts.position ) {

						if ( opts.position.isVector3 ) group.position.copy( opts.position );
						else group.position.set( opts.position[ 0 ], opts.position[ 1 ] ?? 0, opts.position[ 2 ] );

					}
					return group;

				},

				// makeChair(opts) → a COMPLETE chair Group (seat + 4 legs + backrest),
				// correctly proportioned and ORIENTED. Building chairs by hand repeatedly
				// drops the legs and faces the backrest the wrong way for half the seats;
				// this is the blessed, correct-by-construction path. Returns the Group
				// (unadded). opts: { position:[x,y,z]|Vector3, faceToward:[x,z]|Vector3,
				// rotationY, seatColor, legColor, scale, name }.
				// The chair faces +Z by convention (backrest at -Z, behind the occupant).
				// Pass faceToward the TABLE CENTER and it auto-rotates to face it, putting
				// the backrest on the far side — so chairs on opposite sides both face in.
				makeChair: function ( opts = {} ) {

					const T = window.THREE;
					const s = opts.scale ?? 1;
					const group = new T.Group();
					group.name = opts.name ?? 'Chair';

					const seatMat = new T.MeshStandardMaterial( { color: opts.seatColor ?? 0x8B4513, roughness: 0.7, metalness: 0 } );
					const legMat  = new T.MeshStandardMaterial( { color: opts.legColor ?? 0x654321, roughness: 0.8, metalness: 0 } );

					const seatW = 0.5 * s, seatD = 0.5 * s, seatT = 0.08 * s;
					const legH = 0.45 * s, legW = 0.06 * s;
					const backH = 0.5 * s, backT = 0.06 * s;

					const seat = new T.Mesh( new T.BoxGeometry( seatW, seatT, seatD ), seatMat );
					seat.position.set( 0, legH + seatT / 2, 0 );
					seat.name = 'Seat';
					group.add( seat );

					const lx = seatW / 2 - legW / 2, lz = seatD / 2 - legW / 2;
					[ [ - lx, - lz ], [ lx, - lz ], [ - lx, lz ], [ lx, lz ] ].forEach( ( c, i ) => {

						const leg = new T.Mesh( new T.BoxGeometry( legW, legH, legW ), legMat );
						leg.position.set( c[ 0 ], legH / 2, c[ 1 ] );
						leg.name = 'Leg ' + ( i + 1 );
						group.add( leg );

					} );

					// Backrest behind the occupant (at -Z), rising above the seat.
					const back = new T.Mesh( new T.BoxGeometry( seatW, backH, backT ), seatMat );
					back.position.set( 0, legH + seatT + backH / 2, - seatD / 2 + backT / 2 );
					back.name = 'Backrest';
					group.add( back );

					if ( opts.position ) {

						if ( opts.position.isVector3 ) group.position.copy( opts.position );
						else group.position.set( opts.position[ 0 ], opts.position[ 1 ] ?? 0, opts.position[ 2 ] );

					}

					// Orientation: face a target (backrest away from it) or an explicit angle.
					if ( opts.faceToward ) {

						const ft = opts.faceToward;
						const tx = ft.isVector3 ? ft.x : ft[ 0 ];
						const tz = ft.isVector3 ? ft.z : ft[ ft.length === 2 ? 1 : 2 ];
						// local +Z → (sin ry, 0, cos ry); aim it from the chair toward the target.
						group.rotation.y = Math.atan2( tx - group.position.x, tz - group.position.z );

					} else if ( opts.rotationY !== undefined ) {

						group.rotation.y = opts.rotationY;

					}
					return group;

				},

				// ── Third-party API ───────────────────────────────────────────────────
				// fetchAPI(url, options?) — call any HTTP API from the console and get
				// the parsed body back (JSON → object, else text). A plain-object body
				// is auto-JSON-encoded. `await` it:
				//   const d = await fetchAPI('https://api.example.com/items');
				//   await fetchAPI(url, { method:'POST', headers:{Authorization:'Bearer …'}, body:{x:1} });
				// NOTE: this reaches the network — data leaves the device, and the target
				// must allow CORS. (The editor is otherwise fully on-device.)
				fetchAPI: async function ( url, options = {} ) {

					const opts = { ...options };
					if ( opts.body && typeof opts.body === 'object' && ! ( opts.body instanceof FormData ) ) {

						opts.headers = { 'Content-Type': 'application/json', ...( opts.headers || {} ) };
						opts.body = JSON.stringify( opts.body );

					}
					const res = await fetch( url, opts );
					if ( ! res.ok ) throw new Error( `fetchAPI: ${ res.status } ${ res.statusText } — ${ url }` );
					const ct = res.headers.get( 'content-type' ) || '';
					return ct.includes( 'json' ) ? res.json() : res.text();

				},

				// ── Scene Q&A ─────────────────────────────────────────────────────────
				// askScene(question) — ask the AI a natural-language question about the
				// scene. Answer streams into the shell as text; nothing is executed.
				askScene: function ( question ) {

				if ( ! aiEngine.ready ) {

					appendOutput( 'AI not loaded — click "Load AI" first.', 'error' );
					return;

				}

				const messages = buildQAMessages( SCENE_QA_PROMPT, editor, String( question ) );
				appendOutput( '? ' + question, 'ai-prompt' );

				const streamDiv = document.createElement( 'div' );
				streamDiv.className = 'shell-line shell-ai-stream';
				const textNode = document.createTextNode( '' );
				const caret = document.createElement( 'span' );
				caret.className = 'shell-ai-caret';
				caret.textContent = ' ▌';
				streamDiv.appendChild( textNode );
				streamDiv.appendChild( caret );
				output.appendChild( streamDiv );

				let scrollQueued = false;

				aiEngine.stream( messages, {
					maxTokens: 300,
					temperature: 0.2,
					onToken: ( delta ) => {

						if ( delta ) textNode.appendData( delta );
						if ( ! scrollQueued ) {
							scrollQueued = true;
							requestAnimationFrame( () => { output.scrollTop = output.scrollHeight; scrollQueued = false; } );
						}

					},
				} ).then( answer => {

					streamDiv.remove();
					appendOutput( answer, 'result' );

				} ).catch( err => {

					streamDiv.remove();
					appendOutput( 'Q&A error: ' + err.message, 'error' );

				} );

				},

				// ── Get available models ──────────────────────────────────────────────
				// getAvailableModels() — fetch list of available models (WebLLM + APIs)
				getAvailableModels: async function () {

					try {

						const res = await fetch( '/api/models' );
						const data = await res.json();
						console.table( data.models.map( m => ( {
							id: m.id,
							label: m.label,
							source: m.source,
							vram: m.vram_required_MB ? `${ m.vram_required_MB }MB` : 'N/A'
						} ) ) );
						return data;

					} catch ( e ) {

						appendOutput( 'Error fetching models: ' + e.message, 'error' );
						return null;

					}

				},

				// ── Ask external model ────────────────────────────────────────────────
				// askExternal(model, question) — ask an external API (Ollama, OpenAI, Claude)
				askExternal: async function ( model, question ) {

					try {

						const messages = [ { role: 'user', content: question } ];
						const res = await fetch( '/api/chat', {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify( { model, messages, temperature: 0.7, max_tokens: 2000 } )
						} );
						const data = await res.json();

						// Handle both Ollama and OpenAI response formats
						const answer = data.message?.content || data.choices?.[ 0 ]?.message?.content || data.error;
						appendOutput( answer || 'No response', answer ? 'output' : 'error' );
						return answer;

					} catch ( e ) {

						appendOutput( 'Error querying model: ' + e.message, 'error' );
						return null;

					}

				},

				// ── Check API health ──────────────────────────────────────────────────
				// checkApiHealth() — verify external services are running
				checkApiHealth: async function () {

					try {

						const res = await fetch( '/api/health' );
						const health = await res.json();
						console.log( '🔍 API Health:', health );
						return health;

					} catch ( e ) {

						appendOutput( 'API health check failed: ' + e.message, 'error' );
						return null;

					}

				},

				// ── Eval harness ──────────────────────────────────────────────────────
				// evalAI([prompts]) — run the standing eval set through the agentic
				// loop and print a 3-axis (structure/spatial/semantic) pass/fail table.
				evalAI: function ( prompts ) { return evalAI( prompts ); },

				// evalEditMatrix('bare'|'scaffolded'|'constrained') — run the 5 fuzzy
				// editing tasks on the current model; accumulates the model×condition
				// matrix and prints it. Load each model / flip condition / add Haiku for
				// the ceiling. 'constrained' = scaffolded + JSON-schema constrained decode.
				evalEditMatrix: function ( condition ) { return evalEditMatrix( condition ); },
				// saveEvalRows() — download the accumulated per-case rows as JSONL.
				saveEvalRows: function () { return saveEvalRows(); },

			};

			// Build a named-parameter function so every scope var is a local;
			// eval() inside such a function reliably sees those locals.
			// eslint-disable-next-line no-new-func
			const __keys = Object.keys( scope );
			const __vals = __keys.map( k => scope[ k ] );
			const __fn   = new Function( ...__keys, '__shell_src__', 'return eval(__shell_src__)' );
			const result = __fn.call( null, ...__vals, code );

			// Check if scene changed after execution
			const childrenCountAfter = editor.scene.children.length;
			const historyCmdCountAfter = editor.history.undos.length;
			const sceneChanged = childrenCountAfter !== childrenCountBefore || historyCmdCountAfter !== historyCmdCountBefore;

			if ( result !== undefined && ! quiet ) {

				appendOutput( formatValue( result ), 'result' );

			}
			
			// Show scene change message
			if ( sceneChanged && ! quiet ) {
				const childDelta = childrenCountAfter - childrenCountBefore;
				const cmdDelta = historyCmdCountAfter - historyCmdCountBefore;
				let msg = '✨ Scene updated';
				if ( childDelta !== 0 ) {
					msg += ` (${childDelta > 0 ? '+' : ''}${childDelta} objects)`;
				}
				if ( cmdDelta > 0 ) {
					msg += ` — ${cmdDelta} command${cmdDelta > 1 ? 's' : ''} executed`;
				}
				appendOutput( msg, 'result' );
			}

		} catch ( err ) {

			if ( ! quiet ) appendOutput( err.toString(), 'error' );
			return { ok: false, error: err.toString() };

		}

		return { ok: true };

	}

	// ── AI execution — calls execute() directly (identical binding) ───────────

	// Stream AI tokens into a live output div. Returns raw full text.
	async function streamRaw( messages ) {

		const streamDiv = document.createElement( 'div' );
		streamDiv.className = 'shell-line shell-ai-stream';

		// Append only the incremental delta to a text node instead of rewriting the
		// whole output string every token. Rewriting `textContent = full` is O(n) per
		// token → O(n²) over a response, and it forces a layout each time on the same
		// main thread WebLLM's decode loop runs on — which throttles tokens/sec. A
		// text node + appendData( delta ) is O(delta), and scrolling is coalesced to
		// one rAF so we don't force reflow on every token.
		const textNode = document.createTextNode( '' );
		const caret = document.createElement( 'span' );
		caret.className = 'shell-ai-caret';
		caret.textContent = ' ▌';
		streamDiv.appendChild( textNode );
		streamDiv.appendChild( caret );
		output.appendChild( streamDiv );

		let scrollQueued = false;

		const fullText = await aiEngine.stream( messages, {
			onToken: ( delta ) => {
				if ( delta ) textNode.appendData( delta );
				if ( ! scrollQueued ) {
					scrollQueued = true;
					requestAnimationFrame( () => { output.scrollTop = output.scrollHeight; scrollQueued = false; } );
				}
			},
		} );

		streamDiv.remove();
		return fullText;

	}

	// Stream and extract code block (for code-gen path).
	async function streamToOutput( messages ) {

		return extractCode( await streamRaw( messages ) );

	}

	// ── System prompt cache for mutable mode (avoid rebuilding on every request) ──
	// Caches buildSystemPrompt(opsSchema()) result, invalidated when scene changes.
	// opsSchema is expensive to compute (~50ms), SYSTEM_PROMPT is static but large (~4k tokens).
	// Reusing prevents needless prefill delays. Cache key is scene.uuid to detect changes.
	let promptCache = { sceneUuid: null, systemPrompt: null, lastOpsSchema: null };
	let aiTimerInterval = null;  // Timer for counting up elapsed seconds

	function getCachedSystemPrompt( editor ) {

		const currentUuid = editor.scene.uuid;
		if ( promptCache.sceneUuid === currentUuid && promptCache.systemPrompt ) {

			// Scene hasn't changed, reuse cached prompt
			return promptCache.systemPrompt;

		}

		// Scene changed or first call — rebuild and cache
		// OPTIMIZATION: Skip opsSchema when addressable parts exist.
		// If the scene has real parts to edit (.body, .wheel, etc.), those ARE the schema.
		// opsSchema just distracts the model with generic ops and bloats prefill by ~1.5k tokens.
		// Only include opsSchema if there are NO addressable parts (model needs op reference).
		const partsPreview = addressablePartsBlock( editor );
		const schema = partsPreview ? '' : opsSchema();  // Empty schema if parts exist
		const prompt = buildSystemPrompt( schema );
		promptCache = { sceneUuid: currentUuid, systemPrompt: prompt, lastOpsSchema: schema };
		return prompt;

	}

	async function runAI( userPrompt ) {

		// REPL helpers accidentally typed into the AI box → route to the JS surface
		// rather than asking the model to "build" the literal text (e.g. evalAI()).
		// These EXECUTE code, so they're honoured only in mutable mode.
		if ( isMutable() ) {

			if ( /^\s*evalAI\s*\(/.test( userPrompt ) ) { evalAI(); return; }
			// Route the full evalEditMatrix(...) call through the JS surface so any args
			// (condition, { debug:true }) work — it's in scope.
			if ( /^\s*evalEditMatrix\s*\(/.test( userPrompt ) ) { execute( userPrompt ); return; }
			if ( /^\s*saveEvalRows\s*\(/.test( userPrompt ) ) { execute( userPrompt ); return; }

		}

		if ( ! aiEngine.ready ) {

			appendOutput( 'AI not loaded — click "Load AI" first.', 'error' );
			return;

		}

		// Read-only (Mutable unchecked): answer through the lean Q&A prompt only and
		// NEVER execute code or mutate the scene. Every prompt is treated as a
		// question regardless of the leading "?".
		const mutable = isMutable();
		const startsQ = userPrompt.startsWith( '?' );
		const question = startsQ ? userPrompt.slice( 1 ).trim() : userPrompt;
		const isQA = true;  // Always Q&A in read-only mode

		appendOutput( question, 'ai-prompt' );
		
		// Start countdown timer (counting up: 1s, 2s, 3s...)
		let elapsedSeconds = 0;
		if ( aiTimerInterval ) clearInterval( aiTimerInterval );  // Clear any previous timer
		aiStatus.textContent = '⏱ thinking…';
		aiTimerInterval = setInterval( () => {
			elapsedSeconds++;
			aiStatus.textContent = `⏱ ${elapsedSeconds}s`;
		}, 1000 );
		
		aiInput.disabled = true;
		aiAborted = false;
		stopBtn.disabled = false;
		stopBtn.style.display = '';

		try {

			// Always read-only: Q&A mode — stream plain-text answer, do not execute
			const messages = buildQAMessages( SCENE_QA_PROMPT, editor, question );
			const answer   = await streamRaw( messages );
			appendOutput( answer, 'result' );
			if ( aiAborted ) appendOutput( '■ Stopped by user.', 'info' );

		} catch ( err ) {

			appendOutput( 'AI error: ' + err.message, 'error' );

		} finally {

			if ( aiTimerInterval ) clearInterval( aiTimerInterval );  // Stop timer
			aiStatus.textContent = aiAborted ? 'stopped' : 'ready';
			stopBtn.style.display = 'none';
			aiInput.disabled = false;
			updateAIPlaceholder();
			aiInput.focus();

		}

	}

	// True when a Power-class (≥7B) model is loaded — used by the D1 routing hint.
	function isPowerModel() {

		return /\b\d{2,}B\b|7B|13B|34B|70B/i.test( aiEngine.modelId || '' );

	}

	// Input-token budget for the agentic loop, derived from the loaded model's
	// actual context window (reserve ~650 for the model's output). Returns
	// undefined before a window is known, so the loop falls back to its default.
	function aiTokenBudget() {

		// INPUT/context budget: how many tokens the prompt (system + scene + parts +
		// retry history) may occupy before the agentic loop trims/aborts, and the
		// upper bound for the eval harness's single-shot decode. It must track the
		// model's context window MINUS a small output reserve — NOT a fixed output
		// cap. A labeled ~30-part asset's edit prompt already reaches ~8.4k tokens,
		// so clamping this low makes the loop abort with "prompt exceeds the context
		// window" before it can retry. The normal code-gen/Q&A output is separately
		// bounded by AIEngine.stream's own maxTokens default.
		const w = aiEngine.contextWindow;
		return w ? Math.max( 2000, w - 650 ) : undefined;

	}

	// ── Eval harness (Change Set E) ────────────────────────────────────────────
	// Runs the standing eval set through the real agentic loop and prints a 3-axis
	// pass/fail table. REPL: evalAI()  or  evalAI(EVAL_PROMPTS.slice(0,3)).
	async function evalAI( prompts = EVAL_PROMPTS ) {

		if ( ! aiEngine.ready ) { appendOutput( 'AI not loaded — click "Load AI" first.', 'error' ); return; }

		appendOutput( `Running eval set (${ prompts.length } prompts) on ${ aiEngine.modelId }…`, 'info' );

		// One prompt → structured per-axis inputs. Drives the SAME loop as runAI so
		// the eval measures real behaviour, not a separate path.
		async function generate( prompt ) {

			const before = new Set();
			editor.scene.traverse( o => { if ( o.isMesh ) before.add( o.uuid ); } );

			const apiHints = retrieveForPrompt( prompt );
			
			// Use cached system prompt for mutable edits
			const partsPreview = addressablePartsBlock( editor );
			let systemPrompt;
			if ( ! partsPreview ) {
				systemPrompt = SYSTEM_PROMPT;
			} else {
				systemPrompt = getCachedSystemPrompt( editor );
			}
			const messages = buildMessages( systemPrompt, editor, prompt, apiHints );

			// Capture the final generated code (for the not-overfit axis).
			let lastCode = '';
			const streamCode = async ( msgs ) => { lastCode = await streamToOutput( msgs ); return lastCode; };

			const res = await runAgentic( {
				editor, messages, intent: prompt, maxRetries: 3, tokenBudget: aiTokenBudget(),
				deps: { streamCode, execute, appendOutput,
					validateCode, snapshotScene, sceneDiff, confirmChange, diffSummary, inspectScene,
					historyLen: () => editor.history.undos.length,
					rollbackTo: ( len ) => { while ( editor.history.undos.length > len ) editor.history.undo(); } },
			} );

			const execOk = !! ( res && res.ok );
			const objects = [];
			let partCount = 0;
			editor.scene.traverse( o => {

				if ( o.isMesh && ! before.has( o.uuid ) ) {

					partCount ++;
					const s = getSize( o );
					const c = getWorldCenter( o );
					objects.push( { size: [ s.x, s.y, s.z ], pos: [ c.x, c.y, c.z ] } );

				}

			} );

			// Distinct material colours across ALL scene meshes (for the recolor /
			// shared-material axis — both paddles green ⇒ count 1 ⇒ fail).
			const colors = new Set();
			editor.scene.traverse( o => {

				if ( o.isMesh && o.material && o.material.color ) colors.add( o.material.color.getHex() );

			} );

			// hadCode reflects whether code was actually extracted (so a thrown but
			// extracted snippet reads "threw on execute", not "no code extracted");
			// validate/exec collapse to the loop's ok result (it only succeeds when
			// validation + execution both passed).
			return { hadCode: lastCode.length > 0, validateOk: execOk, execOk, objects, partCount,
				code: lastCode, distinctColorCount: colors.size };

		}

		// Non-destructive: snapshot + restore so the eval never erases the user's
		// scene (editor.clear() also wipes persistent storage).
		const _snap = editor.toJSON();
		let results;
		try {

			results = await runEval( {
				prompts,
				deps: {
					generate,
					clearScene: () => { editor.clear(); },
					seed: ( code ) => { execute( code ); },
					log: ( line ) => appendOutput( line, 'info' ),
				},
			} );

		} finally {

			try { editor.clear(); await editor.fromJSON( _snap ); editor.storage.set( editor.toJSON() ); }
			catch ( e ) { appendOutput( `eval cleanup (scene restore) failed: ${ e.message }`, 'error' ); }

		}

		appendOutput( formatTable( results ), 'result' );
		return results;

	}

	// ── Import + Verify UX (M7) ──────────────────────────────────────────────────
	// Persistent (closure-level, not the per-execute scope) so it can be both the
	// REPL command and the auto-open-after-import hook. One panel at a time.
	let _verifyPanel = null;

	function openVerifyPanel( root, opts = {} ) {

		if ( opts.resolve || ! ( root && root.userData && root.userData.labelPass ) ) {

			// Explicit arg → selection → the most recent labeled asset.
			let r = root || editor.selected;
			if ( ! r || ! r.userData || ! r.userData.labelPass ) {

				let found = null;
				editor.scene.traverse( n => { if ( n.userData && n.userData.labelPass ) found = n; } );
				r = found || r;

			}
			root = r;

		}
		if ( ! root ) { appendOutput( 'verifyImport: import an asset first (or select one).', 'info' ); return null; }

		if ( _verifyPanel ) _verifyPanel.close();
		_verifyPanel = createVerifyPanel( root, {
			mount: document.body,   // fixed overlay — stays visible across sidebar tab switches
			log: ( m ) => appendOutput( m, 'result' ),
			selectNodes: ( nodes ) => { if ( nodes && nodes[ 0 ] ) editor.select( nodes[ 0 ] ); },
			onClose: () => { _verifyPanel = null; },
			// One undoable batch across every renamed family (correction-propagation).
			applyAll: ( assignments ) => {

				const cmds = [];
				for ( const { nodes, label } of assignments ) for ( const n of nodes ) cmds.push( new SetLabelCommand( editor, n, label ) );
				if ( cmds.length ) editor.execute( cmds.length === 1 ? cmds[ 0 ] : new MultiCmdsCommand( editor, cmds ) );

			},
		} );
		return _verifyPanel;

	}

	// The import pipeline calls this after Stage-4 labeling (low-coupling hook).
	editor.onVerifyReady = ( root ) => openVerifyPanel( root );

	// ── Eval matrix: the 5 fuzzy tasks × model × {bare, scaffolded} ──────────────
	// Persistent across calls so loading each model / flipping condition builds up
	// the matrix. REPL: evalEditMatrix('scaffolded')  then  evalEditMatrix('bare');
	// load Haiku (dev mode) and run again for the ceiling column.
	const _editMatrix = newMatrix();
	let _matrixRunning = false;
	// Per-(model,condition,task,id) rows accumulated across runs → the re-run
	// JSONL artifact. saveEvalRows() (JS surface) downloads it.
	const _matrixRows = [];

	// Output contract for the 'constrained' condition. Decoding enforces the schema
	// (well-formed JSON), this tells the model the SEMANTICS: emit an { ops:[…] }
	// envelope, one entry per operation, no prose, no code fences.
	const CONSTRAINED_JSON_INSTRUCTION = `

CONSTRAINED OUTPUT MODE — respond with ONLY a JSON object, no prose, no code fences:
{"ops":[{"op":"<op>","selector":"<css-selector>","args":{ … }}]}
- One array entry per operation (a compound request → multiple entries).
- "op" is one of the edit ops above; "selector" targets the part(s); "args" holds op-specific values (e.g. recolor→{"color":"#000000"}, scale→{"factor":2}, move→{"dy":0.3}).
- Do NOT split a single set edit ("all four wheels") into one op per node — one op, one selector.`;

	async function evalEditMatrix( condition = 'scaffolded', opts = {} ) {

		if ( ! aiEngine.ready ) { appendOutput( 'AI not loaded — click "Load AI" first.', 'error' ); return; }
		if ( _matrixRunning ) { appendOutput( '⏳ eval matrix already running — let it finish (run conditions one at a time, awaited).', 'info' ); return; }
		_matrixRunning = true;
		const debug = opts.debug === true;
		const model = aiEngine.modelId || 'unknown';
		// Conditions: 'bare' (no scaffolding), 'scaffolded' (parts injection), and
		// 'constrained' (scaffolded + JSON-schema constrained decoding). The last two
		// both inject parts; 'constrained' additionally forces schema-valid op JSON.
		const injectParts = condition !== 'bare';
		const constrainDecode = condition === 'constrained';
		const opsResponseSchema = constrainDecode ? buildConstrainedOpsSchema() : null;
		appendOutput( `Eval matrix: ${ model } / ${ condition } — measuring the 5 tasks (single-shot, quiet)…`, 'info' );

		// runOnce — ONE quiet generation (no agentic loop, no retries, NO execution).
		// We only need the model's first-shot CODE to parse the op it emitted; the
		// selector resolves deterministically against the setup scene afterward.
		async function runOnce( prompt ) {

			const apiHints = retrieveForPrompt( prompt );
			
			// Use cached system prompt for mutable edits
			const partsPreview = addressablePartsBlock( editor );
			let systemPrompt;
			if ( ! partsPreview ) {
				systemPrompt = SYSTEM_PROMPT;
			} else {
				systemPrompt = getCachedSystemPrompt( editor );
			}
			// In the constrained condition the model must emit schema-valid op JSON
			// (enforced by decoding) rather than the $S/op() JS surface, so tell it the
			// output contract explicitly; the schema handles well-formedness.
			if ( constrainDecode ) systemPrompt += CONSTRAINED_JSON_INSTRUCTION;
			const messages = buildMessages( systemPrompt, editor, prompt, apiHints, { injectParts } );
			const raw = await aiEngine.stream( messages, { maxTokens: aiTokenBudget(), temperature: 0, schema: opsResponseSchema } );
			// Constrained output is raw JSON (no code fence) — parseEmittedOps reads it
			// directly; the JS-code conditions still go through the fenced-code extractor.
			return { code: constrainDecode ? raw : extractCode( raw ) };

		}

		// labelOnce — task-4 probe: a descriptor row → predicted label, SAME model.
		// Condition-aware (previously it ignored the condition → labeling could NEVER
		// show a bare→scaffolded delta, a harness artifact). BARE: raw descriptor + a
		// bare instruction = the floor. SCAFFOLDED: production-faithful framing (like
		// labelPass.LABEL_SYSTEM) — the row schema is explained (first token is the
		// graph role, ignore it; MATERIAL name is a STRONG hint) AND the asset context
		// production gets from seeing the whole part table is supplied. injectParts
		// (the matrix's scaffold knob) selects, so labeling scales with scaffolding
		// like the other tasks and a frontier model can actually pull ahead.
		async function labelOnce( lc ) {

			const descRow = typeof lc === 'string' ? lc : lc.desc;
			const asset = ( lc && lc.asset ) || '3D model';
			const system = injectParts
				? `You label ONE part of an imported ${ asset }, from derived descriptor facts (you cannot see geometry). The first token is the graph role ("leaf"=a mesh) — ignore it. Then come shape, region, size, symmetry pair, and a MATERIAL name which is a STRONG hint ("Rims"→wheel, "Grille"→grille, "Glass"→window). Reply with ONLY a 1-3 word part name.`
				: 'Name this single 3D part in 1-3 words from its descriptor facts. Reply with ONLY the name.';
			try {

				const reply = await aiEngine.complete( [
					{ role: 'system', content: system },
					{ role: 'user', content: descRow },
				], { maxTokens: 12, temperature: 0 } );
				return String( reply || '' ).split( /\r?\n/ )[ 0 ].replace( /["'`.]/g, '' ).trim();

			} catch { return ''; }

		}

		// NON-DESTRUCTIVE: the eval clears the scene (and editor.clear() also wipes
		// persistent storage) per case, so snapshot the user's scene first and
		// restore + re-persist it after — running an eval must never erase your work.
		const _sceneSnapshot = editor.toJSON();

		let taskScores;
		try {

			taskScores = await runEditMatrix( {
				clearScene: () => { editor.clear(); },
				runSetup: ( code ) => { execute( code, { quiet: true } ); },   // fixtures run silently
				runOnce,
				resolveSelector: ( sel ) => new Set( selectorEngine.query( editor.scene, sel ).map( n => n.name ).filter( Boolean ) ),
				colorBase: editColorBase,
				normalizeColor: ( c ) => { try { return new window.THREE.Color( c ).getHex(); } catch { return null; } },
				labelOnce,
				onProgress: ( msg ) => { aiStatus.textContent = msg; },
				onRow: ( r ) => { _matrixRows.push( { model, condition, task: r.task, id: r.id, score: r.score, raw: r.raw, parsed: r.parsed } ); },
				onCase: debug ? ( d ) => {

					const flags = `op:${ d.pass.op ? '✓' : '✗' } sel:${ d.pass.sel ? '✓' : '✗' } arg:${ d.pass.arg ? '✓' : '✗' } multi:${ d.pass.multi ? '✓' : '✗' }`;
					appendOutput( `  [${ d.id }] "${ d.prompt }" → ${ d.emittedSel }   ${ flags }`, 'info' );
					if ( ! d.pass.sel && d.reasons.sel && d.reasons.sel.length ) appendOutput( `      sel: ${ d.reasons.sel.join( '; ' ) }`, 'info' );

				} : null,
			} );

		} finally {

			_matrixRunning = false;
			// Restore the user's scene and re-persist it (editor.clear() wiped storage).
			try {

				editor.clear();
				await editor.fromJSON( _sceneSnapshot );
				editor.storage.set( editor.toJSON() );

			} catch ( e ) { appendOutput( `eval cleanup (scene restore) failed: ${ e.message }`, 'error' ); }

		}

		recordRun( _editMatrix, { model, condition, taskScores } );
		const line = Object.entries( taskScores ).map( ( [ t, s ] ) => `${ t } ${ s.passed }/${ s.total }` ).join( '   ' );
		appendOutput( `${ model } / ${ condition }:   ${ line }`, 'result' );
		appendOutput( formatMatrix( _editMatrix ), 'result' );
		appendOutput( `${ _matrixRows.length } row(s) logged — saveEvalRows() to download JSONL.`, 'info' );
		return taskScores;

	}

	// Download the accumulated per-(model,condition,task,id) rows as JSONL.
	function saveEvalRows() {

		if ( ! _matrixRows.length ) { appendOutput( 'No eval rows yet — run evalEditMatrix(...) first.', 'info' ); return; }
		const jsonl = _matrixRows.map( r => JSON.stringify( r ) ).join( '\n' );
		const blob = new Blob( [ jsonl ], { type: 'application/x-ndjson' } );
		const url = URL.createObjectURL( blob );
		const a = document.createElement( 'a' );
		a.href = url; a.download = 'eval-matrix-rows.jsonl'; a.click();
		URL.revokeObjectURL( url );
		appendOutput( `Saved ${ _matrixRows.length } eval rows → eval-matrix-rows.jsonl`, 'result' );

	}

	// ── Stop AI button ─────────────────────────────────────────────────────────

	stopBtn.addEventListener( 'click', function () {

		if ( ! aiEngine.ready ) return;
		aiAborted = true;
		aiEngine.interrupt();
		
		// Make input responsive IMMEDIATELY (don't wait for stream to fully exit)
		// User should be able to type again instantly, even if stream cleanup is ongoing
		aiInput.disabled = false;
		aiInput.focus();
		stopBtn.disabled = true;
		aiStatus.textContent = 'stopping…';

	} );

	// ── Load AI button ────────────────────────────────────────────────────────

	loadBtn.addEventListener( 'click', async function () {

		if ( aiEngine.ready || aiEngine.loading ) return;

		const selectedModel = modelSelect.value;
		const isClient = isClientModel( selectedModel );
		const isServerExternal = ! isClient && [ 'ollama:', 'gpt-', 'claude-' ].some( prefix => selectedModel.startsWith( prefix ) );
		const isExternal = isClient || isServerExternal;

		loadBtn.disabled = true;
		modelSelect.disabled = true;
		aiStatus.textContent = isExternal ? 'checking…' : 'loading…';
		progressWrap.style.display = isExternal ? 'none' : 'block';
		progressBar.style.width = '0%';

		try {

			if ( isClient ) {

				// Client-side external API: the browser calls the provider DIRECTLY
				// (no server proxy). No health check — the first request surfaces any
				// key/CORS error. Same unified streamFn contract as the server path.
				const cfg = getClientConfig( selectedModel );
				if ( ! cfg ) throw new Error( 'client API config not found — reconfigure it via ⚙ API' );
				if ( ! cfg.model ) throw new Error( 'client API config has no model id' );

				const { stream, interrupt } = makeClientEngine( cfg );
				aiEngine.setExternalAPI( cfg.model, stream, interrupt );

				aiStatus.textContent = 'ready';
				loadBtn.textContent = '✓ AI';
				unloadBtn.style.display = '';
				aiInput.disabled = false;
				updateAIPlaceholder();
				aiInput.focus();
				localStorage.setItem( 'shell-ai-model', selectedModel );
				appendOutput( 'AI ready — model: ' + cfg.model + '  (client-side ' + cfg.provider + ' API, direct from browser)', 'info' );

			} else if ( isServerExternal ) {

				// External API: verify health and set up via aiEngine
				const healthRes = await fetch( '/api/health' );
				const health = await healthRes.json();

				// Check if the selected API source is available
				const source = selectedModel.startsWith( 'ollama:' ) ? 'ollama' : selectedModel.startsWith( 'gpt-' ) ? 'openai' : 'claude';
				if ( health.services[ source ] !== 'running' && health.services[ source ] !== 'configured' ) {

					throw new Error( `${source} API not configured or not running` );

				}

				// Set up external API with unified interface. When the caller supplies
				// an onToken handler we ask the server to STREAM (Server-Sent Events) so
				// cloud replies arrive token-by-token, exactly like the local WebLLM
				// path; complete() (no onToken) keeps the simpler one-shot JSON request.
				const streamFn = async ( messages, opts = {} ) => {

					const wantStream = typeof opts.onToken === 'function';

					// Retry on 429 (rate limit) with backoff so a transient limit never
					// returns empty (which the agentic loop would mistake for "no code
					// block" and waste a retry). The server also retries upstream; this
					// is the client-side safety net for sustained eval throughput.
					const maxRateRetries = 6;
					for ( let attempt = 0; ; attempt ++ ) {

						const res = await fetch( '/api/chat', {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify( {
								model: selectedModel,
								messages,
								temperature: opts.temperature ?? 0.7,
								stream: wantStream,
								// Cloud models bill by actual output tokens and stop at
								// end_turn, so a generous cap costs nothing for short replies
								// but prevents mid-code-block truncation (an unterminated
								// fence makes the extractor correctly reject the output).
								// The 600-token default is tuned for memory-bound WebLLM;
								// it's far too low for verbose cloud models.
								max_tokens: Math.max( opts.maxTokens ?? 0, 4096 ),
								// Constrained-decode schema ('constrained' eval condition):
								// the server relays it to each provider's structured-output
								// mechanism (Ollama format / OpenAI json_schema / Claude tool).
								...( opts.schema ? { schema: opts.schema } : {} )
							} )
						} );

						// Rate limited — wait and retry (don't surface as a code failure).
						// Checked before reading the body so the stream isn't consumed.
						if ( res.status === 429 && attempt < maxRateRetries ) {

							const retryAfter = parseFloat( res.headers.get( 'retry-after' ) );
							const waitMs = Number.isFinite( retryAfter )
								? Math.ceil( retryAfter * 1000 )
								: Math.min( 2000 * Math.pow( 2, attempt ), 30000 );
							opts.onToken?.( '', `⏳ rate limited — waiting ${ Math.round( waitMs / 1000 ) }s…` );
							await new Promise( r => setTimeout( r, waitMs ) );
							continue;

						}

						const contentType = res.headers.get( 'content-type' ) || '';

						// ── Streaming path (Server-Sent Events) ─────────────────────────
						if ( wantStream && res.ok && contentType.includes( 'text/event-stream' ) ) {

							const reader = res.body.getReader();
							const decoder = new TextDecoder();
							let buf = '', full = '';

							for ( ;; ) {

								const { value, done } = await reader.read();
								if ( done ) break;
								buf += decoder.decode( value, { stream: true } );

								// SSE events are separated by a blank line.
								let sep;
								while ( ( sep = buf.indexOf( '\n\n' ) ) >= 0 ) {

									const evt = buf.slice( 0, sep );
									buf = buf.slice( sep + 2 );

									for ( const rawLine of evt.split( '\n' ) ) {

										const line = rawLine.trim();
										if ( ! line.startsWith( 'data:' ) ) continue;
										const payload = line.slice( 5 ).trim();
										if ( ! payload || payload === '[DONE]' ) continue;

										let o;
										try { o = JSON.parse( payload ); } catch { continue; }
										if ( o.error ) throw new Error( o.error );
										if ( o.delta ) { full += o.delta; opts.onToken( o.delta, full ); }

									}

								}

							}

							return full;

						}

						// ── One-shot JSON path (complete(), or non-streaming server) ────
						const data = await res.json().catch( () => ( {} ) );

						// Surface API/transport errors as exceptions so the loop reports
						// them instead of mistaking an error string for "no code".
						if ( ! res.ok || data.error ) {

							const msg = data.error || `HTTP ${ res.status }`;
							const err = new Error( msg );
							err.status = res.status;
							throw err;

						}

						// Handle both Ollama and OpenAI response formats
						const answer = data.message?.content || data.choices?.[ 0 ]?.message?.content || '';

						// Deliver the full answer to a streaming UI in one chunk when the
						// server didn't stream (keeps the live output div populated).
						if ( opts.onToken ) opts.onToken( '', answer );

						return answer;

					}

				};

				const interruptFn = () => {}; // No-op for external APIs

				aiEngine.setExternalAPI( selectedModel, streamFn, interruptFn );

				aiStatus.textContent = 'ready';
				loadBtn.textContent = '✓ AI';
				unloadBtn.style.display = '';
				aiInput.disabled = false;
				updateAIPlaceholder();
				aiInput.focus();
				localStorage.setItem( 'shell-ai-model', selectedModel );
				appendOutput( 'AI ready — model: ' + selectedModel + '  (external API)', 'info' );

			} else {

				// WebLLM: standard loading. On-device inference needs working WebGPU
				// compute — software-emulated GPUs (llvmpipe / SwiftShader on Linux)
				// expose navigator.gpu but fail to compile compute shaders. Check up
				// front so we can point the user at the cloud models instead of a
				// cryptic "Invalid ShaderModule … compute stage" failure mid-load.
				if ( ! navigator.gpu ) {

					throw new Error( 'WebGPU is not available in this browser, so on-device models can\'t run. ' +
						'Pick a cloud model (gpt-… / claude-… / ollama:…) instead, or enable WebGPU (chrome://gpu).' );

				}

				progressWrap.style.display = 'block';

				await aiEngine.init( selectedModel, ( p ) => {

					const pct = Math.round( ( p.progress || 0 ) * 100 );
					progressBar.style.width = pct + '%';
					aiStatus.textContent = p.text ?? ( pct + '%' );

				} );

				progressBar.style.width = '100%';
				setTimeout( () => { progressWrap.style.display = 'none'; }, 600 );
				aiStatus.textContent = 'ready';
				loadBtn.textContent = '✓ AI';
				unloadBtn.style.display = '';
				aiInput.disabled = false;
				updateAIPlaceholder();
				aiInput.focus();
				localStorage.setItem( 'shell-ai-model', selectedModel );
				appendOutput( 'AI ready — model: ' + selectedModel +
					'  (context window: ' + ( aiEngine.contextWindow || 'default' ) + ' tokens)', 'info' );

			}

		} catch ( err ) {

			progressWrap.style.display = 'none';
			aiStatus.textContent = 'failed';
			loadBtn.disabled = false;
			modelSelect.disabled = false;

			// A failed compute-shader compile (e.g. "Invalid ShaderModule … compute
			// stage … index_kernel") means WebGPU can't run on this GPU — almost
			// always a software/emulated driver. Steer the user to the cloud models.
			const msg = String( err && err.message || err );
			const isWebGPUFailure = ! isExternal && /shadermodule|compute stage|index_kernel|webgpu|gpu device|createcomputepipeline/i.test( msg );

			if ( isWebGPUFailure ) {

				appendOutput( 'AI load error: on-device model failed to start — this browser/GPU can\'t run WebGPU compute ' +
					'(common with software rendering such as llvmpipe/SwiftShader on Linux). ' +
					'Use a cloud model (gpt-…, claude-…, or ollama:…) instead, or enable a hardware GPU at chrome://gpu.\n\n' +
					'Details: ' + msg, 'error' );

			} else {

				appendOutput( 'AI load error: ' + msg, 'error' );

			}

		}

	} );

	// ── Unload AI ─────────────────────────────────────────────────────────────
	// Release the current model so the user can pick a different one and Load
	// again. Resets the header back to its pre-load state.
	unloadBtn.addEventListener( 'click', async function () {

		if ( aiEngine.loading ) return;

		unloadBtn.disabled = true;
		aiStatus.textContent = 'unloading…';

		try {

			aiEngine.interrupt();
			await aiEngine.unload();

		} catch ( err ) {

			console.debug( 'AI unload error:', err && err.message || err );

		}

		unloadBtn.disabled = false;
		unloadBtn.style.display = 'none';
		loadBtn.disabled = false;
		loadBtn.textContent = 'Load AI';
		modelSelect.disabled = false;
		aiInput.disabled = true;
		aiStatus.textContent = '';
		appendOutput( 'AI unloaded — select a model and click "Load AI" to switch.', 'info' );

	} );

	// ── AI input keydown ──────────────────────────────────────────────────────

	aiInput.addEventListener( 'keydown', function ( event ) {

		event.stopPropagation();

		// Escape to interrupt running AI stream
		if ( event.key === 'Escape' ) {

			event.preventDefault();
			if ( ! stopBtn.disabled ) {
				// Stream is running — trigger stop
				stopBtn.click();
			}
			return;

		}

		if ( event.key === 'Enter' ) {

			event.preventDefault();
			const val = aiInput.value.trim();
			if ( val ) {

				aiInput.value = '';
				runAI( val );

			}

		}

	} );

	// ── JS input keydown ──────────────────────────────────────────────────────

	input.addEventListener( 'keydown', function ( event ) {

		event.stopPropagation(); // prevent global shortcut handler from eating Backspace/Delete

		if ( event.key === 'Enter' && ! event.shiftKey ) {

			event.preventDefault();
			execute( input.value );
			input.value = '';
			input.style.height = 'auto';
			return;

		}

		if ( event.key === 'ArrowUp' ) {

			if ( input.value.indexOf( '\n' ) === - 1 ) {

				event.preventDefault();
				if ( historyIndex === - 1 ) savedInput = input.value;
				if ( historyIndex < history.length - 1 ) {

					historyIndex ++;
					input.value = history[ historyIndex ];

				}

			}

		}

		if ( event.key === 'ArrowDown' ) {

			if ( input.value.indexOf( '\n' ) === - 1 ) {

				event.preventDefault();
				if ( historyIndex > 0 ) {

					historyIndex --;
					input.value = history[ historyIndex ];

				} else if ( historyIndex === 0 ) {

					historyIndex = - 1;
					input.value = savedInput;

				}

			}

		}

		// Auto-grow textarea height
		setTimeout( function () {

			input.style.height = 'auto';
			input.style.height = Math.min( input.scrollHeight, 120 ) + 'px';

		}, 0 );

	} );

	// ── Toggle signal ─────────────────────────────────────────────────────────
	// Tab visibility is owned by the Sidebar; here we just focus the input when
	// the shell tab is (re)opened.

	signals.toggleShell.add( function () {

		setTimeout( () => input.focus(), 50 );

	} );

	// ── Show JS for selection signal ──────────────────────────────────────────
	// Triggered from View → Show JS for Selection.
	// The Sidebar selects the shell tab; here we print JS for the selected object.

	signals.showJSForSelection.add( function () {

		const obj = editor.selected;

		if ( ! obj ) {

			appendOutput( '// No object selected — generating JS for entire scene:', 'info' );
			const result = sceneToJS( editor );
			appendOutput( result.code, 'result' );
			if ( result.lossy ) appendOutput( '⚠ Lossy fallback used: ' + result.lossyReasons.join( '; ' ), 'error' );
			return;

		}

		appendOutput( `// Generated JS for: "${obj.name || obj.type}"  uuid: ${obj.uuid.slice( 0, 8 )}`, 'info' );
		const result = objectToJS( obj );
		appendOutput( result.code, 'result' );
		if ( result.lossy ) appendOutput( '⚠ Lossy fallback used: ' + result.lossyReasons.join( '; ' ), 'error' );

		output.scrollTop = output.scrollHeight;

	} );

	// ── Welcome hint ──────────────────────────────────────────────────────────
	// Keep startup quiet — the full command list is available via `help`.

	appendOutput( 'Type help for the list of available commands.', 'info' );

	// Prints the full command reference (invoked by the `help` command).
	function printHelp() {

		appendOutput( 'three.js editor shell  —  globals: editor  THREE  scene  camera  renderer  AddObjectCommand  RemoveObjectCommand  SetPositionCommand  SetRotationCommand  SetScaleCommand  SetMaterialColorCommand  SetValueCommand', 'info' );
		appendOutput( 'scene lookup: findObject(name)  findAll(name)  findOfType(type)  findNear(mesh,radius)  summarize()', 'info' );
		appendOutput( 'scene intelligence: findByDescription("right arm of the red person")  describeObject(o)  listCandidates(text)  resolvePartAI(text)', 'info' );
		appendOutput( 'agentic tools: findAPI(text)  whatsVisible()  whatsAt(x,y)  — AI requests run a bounded generate→validate→execute→observe→fix loop', 'info' );
		appendOutput( 'spatial: getSize(obj)  getTopY(obj)  getCenter(obj)  placeOnTop(child,target)', 'info' );
		appendOutput( '3rd-party API: const d = await fetchAPI(url[, {method,headers,body}])  — JSON→object (network/CORS apply)', 'info' );
		appendOutput( 'dev API (--dev mode): External models (Ollama, OpenAI, Claude) appear in model dropdown when available  — select and click "Load AI"', 'info' );
		appendOutput( 'AI Q&A: prefix AI input with ? to ask questions  —  or call askScene("question") in REPL', 'info' );
		appendOutput( 'AI eval: evalAI() runs the standing eval set (pong/chess/hoop…) and prints a structure/spatial/semantic table', 'info' );
		appendOutput( 'animation: addClip(obj,clip)  addSpinClip(obj,{axis:"y",turns:1,seconds:8,pingPong:true})  — open the Animations tab to play', 'info' );
		appendOutput( 'codegen: showJS()  objectToJS(obj)  sceneToJS()  sceneEqual(a,b)', 'info' );
		appendOutput( 'modeling ops: booleanUnion(a,b)  booleanSubtract(a,b)  booleanIntersect(a,b)  mirrorMesh(m,axis)  arrayDuplicate(m,n,dx,dy,dz)  subdivide(m,iters)', 'info' );
		appendOutput( 'organic geometry: LatheGeometry(pts,segs)  TubeGeometry(curve,…)  ExtrudeGeometry(shape,{})  CatmullRomCurve3(pts)', 'info' );
		appendOutput( 'PBR textures: makeTexture(fn,size)  makeCheckerTex(sz,dark,light,tiles)  makeGridTex(sz,color,divs,bg)  + MeshPhysicalMaterial', 'info' );
		appendOutput( 'edit mode: enterEditMode()  exitEditMode()  extrude(d)  inset(t)  bevel(t)  deleteFaces()  weld(eps)  planarUV(axis)  boxUV()  — Tab to toggle', 'info' );
		appendOutput( 'selection criteria (M6): selectTopFaces(count)  selectFacingUp(threshold)  selectBoundaryEdges()  selectFaces(…ids)  selectVertices(…ids)  selectEdges(…ids)  clearSelection()', 'info' );

	}

	return container;

}

export { Shell };
