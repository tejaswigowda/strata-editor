import { UIPanel } from './libs/ui.js';
import { AddObjectCommand } from './commands/AddObjectCommand.js';
import { RemoveObjectCommand } from './commands/RemoveObjectCommand.js';
import { SetPositionCommand } from './commands/SetPositionCommand.js';
import { SetRotationCommand } from './commands/SetRotationCommand.js';
import { SetScaleCommand } from './commands/SetScaleCommand.js';
import { SetMaterialColorCommand } from './commands/SetMaterialColorCommand.js';
import { SetValueCommand } from './commands/SetValueCommand.js';
import { AI_MODELS, SYSTEM_PROMPT } from './AIPrompt.js';
import { extractCode, buildMessages } from './AIUtils.js';
import { AIEngine, getModelList } from './AIEngine.js';
import { objectToJS, sceneToJS } from './scene/codegen.js';
import { sceneEqual } from './scene/sceneEqual.js';
import { summarizeScene as summarizeSceneFull } from './scene/summarize.js';
import { booleanUnion, booleanSubtract, booleanIntersect } from './mesh/ops/boolean.js';
import { mirrorMesh } from './mesh/ops/mirror.js';
import { arrayDuplicate } from './mesh/ops/array.js';
import { subdivide } from './mesh/ops/subdivide.js';
import { serializeForAI as opsSchema } from './mesh/ops/index.js';



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

	getModelList()
		.filter( m => CODE_KEYWORDS.some( kw => m.model_id.toLowerCase().includes( kw ) ) )
		.forEach( m => {

			const opt = document.createElement( 'option' );
			opt.value = m.model_id;
			opt.textContent = m.model_id + fmtVram( m.vram_required_MB );
			modelSelect.appendChild( opt );

		} );

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

	const aiStatus = document.createElement( 'span' );
	aiStatus.id = 'shell-ai-status';

	header.appendChild( headerTitle );
	header.appendChild( modelSelect );
	header.appendChild( loadBtn );
	header.appendChild( aiStatus );
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

	const aiEngine = new AIEngine();

	// Expose on editor so other modules (e.g. Menubar.Git) can use the loaded engine
	editor.aiEngine = aiEngine;

	// ── Helpers ───────────────────────────────────────────────────────────────

	function appendOutput( text, type ) {

		const line = document.createElement( 'div' );
		line.className = 'shell-line shell-' + type;
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

		output.appendChild( line );
		output.scrollTop = output.scrollHeight;

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

	function execute( code ) {

		code = code.trim();
		if ( ! code ) return;

		history.unshift( code );
		if ( history.length > 500 ) history.pop();
		historyIndex = - 1;
		savedInput = '';

		appendOutput( '> ' + code, 'cmd' );

		try {

			// Scope vars become named parameters of a new Function; direct eval()
			// inside that function reliably sees all parameters as local variables.
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
				Euler:                window.THREE.Euler,
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
				// findObject(query) — find the first scene object whose name contains
				// `query` (case-insensitive). Falls back to editor.selected if no match.
				// Returns null if nothing found at all.
				// findObject(query) — first object whose name matches (exact then substring)
				findObject: function ( query ) {

					if ( ! query ) return editor.selected;
					const q = String( query ).toLowerCase().trim();
					let exact = null, sub = null;

					editor.scene.traverse( function ( obj ) {

						const name = ( obj.name || '' ).toLowerCase();
						if ( ! exact && name === q ) exact = obj;
						if ( ! sub   && name.includes( q ) ) sub = obj;

					} );

					return exact || sub || null;

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

				// ── Modeling ops (M1/M2) — same surface for UI and AI ─────────────────
				// Closures capture `editor` so the AI can call them without it.

				booleanUnion:     ( meshA, meshB, keepInputs )            => booleanUnion( editor, meshA, meshB, keepInputs ),
				booleanSubtract:  ( meshA, meshB, keepInputs )            => booleanSubtract( editor, meshA, meshB, keepInputs ),
				booleanIntersect: ( meshA, meshB, keepInputs )            => booleanIntersect( editor, meshA, meshB, keepInputs ),
				mirrorMesh:       ( mesh, axis )                          => mirrorMesh( editor, mesh, axis ),
				arrayDuplicate:   ( mesh, count, ox, oy, oz )             => arrayDuplicate( editor, mesh, count, ox, oy, oz ),
				subdivide:        ( mesh, iterations )                    => subdivide( editor, mesh, iterations ),

				// Diagnostic: print the registered op schema
				listOps:          () => opsSchema(),
			};

			// Build a named-parameter function so every scope var is a local;
			// eval() inside such a function reliably sees those locals.
			// eslint-disable-next-line no-new-func
			const __keys = Object.keys( scope );
			const __vals = __keys.map( k => scope[ k ] );
			const __fn   = new Function( ...__keys, '__shell_src__', 'return eval(__shell_src__)' );
			const result = __fn.call( null, ...__vals, code );

			if ( result !== undefined ) {

				appendOutput( formatValue( result ), 'result' );

			}

		} catch ( err ) {

			appendOutput( err.toString(), 'error' );
			return { ok: false, error: err.toString() };

		}

		return { ok: true };

	}

	// ── AI execution — calls execute() directly (identical binding) ───────────

	// Stream AI tokens into a live output div, remove when done, return extracted code.
	async function streamToOutput( messages ) {

		const streamDiv = document.createElement( 'div' );
		streamDiv.className = 'shell-line shell-ai-stream';
		output.appendChild( streamDiv );

		const fullText = await aiEngine.stream( messages, {
			onToken: ( _delta, full ) => {
				streamDiv.textContent = full + ' ▌';
				output.scrollTop = output.scrollHeight;
			},
		} );

		streamDiv.remove();
		return extractCode( fullText );

	}

	async function runAI( userPrompt ) {

		if ( ! aiEngine.ready ) {

			appendOutput( 'AI not loaded — click "Load AI" first.', 'error' );
			return;

		}

		appendOutput( '(AI) ' + userPrompt, 'ai-prompt' );
		aiStatus.textContent = 'thinking…';
		aiInput.disabled = true;

		try {

			const messages = buildMessages( SYSTEM_PROMPT, editor, userPrompt );
			const code     = await streamToOutput( messages );
			const result   = execute( code );

			if ( ! result.ok ) {

				appendOutput( '⟳ error — retrying with context…', 'info' );

				const retryMessages = [
					...messages,
					{ role: 'assistant', content: code },
					{ role: 'user', content: 'That threw: ' + result.error + '\n\nFix the code. Output corrected JavaScript only.' },
				];

				const retryCode = await streamToOutput( retryMessages );
				execute( retryCode );

			}

		} catch ( err ) {

			appendOutput( 'AI error: ' + err.message, 'error' );

		} finally {

			aiStatus.textContent = 'ready';
			aiInput.disabled = false;
			aiInput.focus();

		}

	}

	// ── Load AI button ────────────────────────────────────────────────────────

	loadBtn.addEventListener( 'click', async function () {

		if ( aiEngine.ready || aiEngine.loading ) return;
		loadBtn.disabled = true;
		modelSelect.disabled = true;
		aiStatus.textContent = 'loading…';
		progressWrap.style.display = 'block';
		progressBar.style.width = '0%';

		try {

			await aiEngine.init( modelSelect.value, ( p ) => {

				const pct = Math.round( ( p.progress || 0 ) * 100 );
				progressBar.style.width = pct + '%';
				aiStatus.textContent = p.text ?? ( pct + '%' );

			} );

			progressBar.style.width = '100%';
			setTimeout( () => { progressWrap.style.display = 'none'; }, 600 );
			aiStatus.textContent = 'ready';
			loadBtn.textContent = '✓ AI';
			aiInput.disabled = false;
			aiInput.focus();
			localStorage.setItem( 'shell-ai-model', modelSelect.value );
			appendOutput( 'AI ready — model: ' + modelSelect.value, 'info' );

		} catch ( err ) {

			progressWrap.style.display = 'none';
			aiStatus.textContent = 'failed';
			loadBtn.disabled = false;
			modelSelect.disabled = false;
			appendOutput( 'AI load error: ' + err.message, 'error' );

		}

	} );

	// ── AI input keydown ──────────────────────────────────────────────────────

	aiInput.addEventListener( 'keydown', function ( event ) {

		event.stopPropagation();

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

	signals.toggleShell.add( function () {

		const hidden = container.dom.style.display === 'none';
		container.setDisplay( hidden ? '' : 'none' );
		if ( hidden ) setTimeout( () => input.focus(), 50 );

	} );

	// ── Show JS for selection signal ──────────────────────────────────────────
	// Triggered from View → Show JS for Selection.
	// Ensures the shell is visible, then runs showJS() for the selected object.

	signals.showJSForSelection.add( function () {

		// Make shell visible
		container.setDisplay( '' );

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

	// ── Welcome message ───────────────────────────────────────────────────────

	appendOutput( 'three.js editor shell  —  globals: editor  THREE  scene  camera  renderer  AddObjectCommand  RemoveObjectCommand  SetPositionCommand  SetRotationCommand  SetScaleCommand  SetMaterialColorCommand  SetValueCommand', 'info' );
	appendOutput( 'scene lookup: findObject(name)  findAll(name)  findOfType(type)  findNear(mesh,radius)  summarize()', 'info' );
	appendOutput( 'codegen: showJS()  objectToJS(obj)  sceneToJS()  sceneEqual(a,b)', 'info' );
	appendOutput( 'modeling ops: booleanUnion(a,b)  booleanSubtract(a,b)  booleanIntersect(a,b)  mirrorMesh(m,axis)  arrayDuplicate(m,n,dx,dy,dz)  subdivide(m,iters)  — type listOps() for schema', 'info' );

	return container;

}

export { Shell };
