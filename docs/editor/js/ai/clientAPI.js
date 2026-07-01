// ── ai/clientAPI.js ───────────────────────────────────────────────────────────
// CLIENT-SIDE external API option (coexists with the DEV-mode server proxy).
//
// The server path (`DEV=1 node server.js` → /api/chat) keeps API keys server-side
// and is the default. THIS module is the browser-native alternative: the user
// configures a provider + key in the editor and the browser calls the provider's
// API DIRECTLY (no server needed — works on static GitHub Pages hosting too).
//
// Same contract as the server `streamFn` used by AIEngine.setExternalAPI:
//   streamFn(messages, { onToken, maxTokens, temperature }) → Promise<fullText>
//   - when onToken is present, request SSE streaming and call onToken(delta, full)
//   - otherwise one-shot; returns the full string
//
// Sovereignty note: client-side keys live in localStorage (same-origin scripts can
// read them, exactly like the git token) and requests leave the device to the
// provider. This is opt-in and clearly the LESS-sovereign path; the on-device
// WebLLM models remain the default. Providers must allow browser CORS (OpenAI and
// Ollama do; Anthropic requires the dangerous-direct-browser-access opt-in header).

const STORE_KEY = 'client-api-providers';

// ── Provider presets ──────────────────────────────────────────────────────────
// `wire` selects the request/stream shape: 'openai' (OpenAI-compatible, incl.
// Ollama's /v1 and any compatible endpoint) or 'anthropic'.

export const PROVIDER_PRESETS = {
	openai: {
		label: 'OpenAI',
		wire: 'openai',
		baseUrl: 'https://api.openai.com/v1',
		needsKey: true,
		modelHint: 'gpt-4o-mini',
		models: [ 'gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1', 'o4-mini', 'o3-mini' ],
	},
	anthropic: {
		label: 'Anthropic (Claude)',
		wire: 'anthropic',
		baseUrl: 'https://api.anthropic.com/v1',
		needsKey: true,
		modelHint: 'claude-3-5-sonnet-latest',
		models: [ 'claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest', 'claude-3-7-sonnet-latest', 'claude-sonnet-4-0', 'claude-opus-4-0', 'claude-3-opus-latest', 'claude-3-haiku-20240307' ],
	},
	ollama: {
		label: 'Ollama (local)',
		wire: 'openai',
		baseUrl: 'http://localhost:11434/v1',
		needsKey: false,
		modelHint: 'llama3.2',
		models: [ 'llama3.2', 'llama3.1', 'qwen2.5-coder', 'mistral', 'phi4' ],
	},
	custom: {
		label: 'Custom (OpenAI-compatible)',
		wire: 'openai',
		baseUrl: '',
		needsKey: false,
		modelHint: 'model-id',
		models: [],
	},
};

// ── Settings store (localStorage) ───────────────────────────────────────────────

/** @returns {Array<{id,provider,label,model,baseUrl,apiKey}>} */
export function loadClientProviders() {

	try {

		const raw = localStorage.getItem( STORE_KEY );
		const arr = raw ? JSON.parse( raw ) : [];
		return Array.isArray( arr ) ? arr : [];

	} catch ( e ) {

		return [];

	}

}

function saveClientProviders( list ) {

	localStorage.setItem( STORE_KEY, JSON.stringify( list ) );

}

function uid() {

	return ( crypto.randomUUID ? crypto.randomUUID() : String( Date.now() ) + Math.random().toString( 16 ).slice( 2 ) );

}

/** Add or update a provider config. Returns the saved config (with id). */
export function upsertClientProvider( cfg ) {

	const list = loadClientProviders();
	const wire = ( PROVIDER_PRESETS[ cfg.provider ] || PROVIDER_PRESETS.custom ).wire;
	const record = {
		id: cfg.id || uid(),
		provider: cfg.provider,
		wire,
		label: ( cfg.label || '' ).trim() || defaultLabel( cfg ),
		model: ( cfg.model || '' ).trim(),
		baseUrl: ( cfg.baseUrl || PROVIDER_PRESETS[ cfg.provider ]?.baseUrl || '' ).trim(),
		apiKey: ( cfg.apiKey || '' ).trim(),
	};
	const idx = list.findIndex( p => p.id === record.id );
	if ( idx >= 0 ) list[ idx ] = record; else list.push( record );
	saveClientProviders( list );
	return record;

}

export function removeClientProvider( id ) {

	saveClientProviders( loadClientProviders().filter( p => p.id !== id ) );

}

function defaultLabel( cfg ) {

	const preset = PROVIDER_PRESETS[ cfg.provider ]?.label || cfg.provider;
	return `${ preset }: ${ cfg.model || '?' }`;

}

// ── Dropdown wiring ─────────────────────────────────────────────────────────────

/**
 * Dropdown entries for configured client providers.
 * value is `client:<id>` so the host can route to the direct-call streamFn.
 * @returns {Array<{value,label,source}>}
 */
export function listClientModels() {

	return loadClientProviders()
		.filter( p => p.model )
		.map( p => ( { value: `client:${ p.id }`, label: `${ p.label }  (browser)`, source: 'client' } ) );

}

/** Resolve a `client:<id>` dropdown value back to its provider config. */
export function getClientConfig( value ) {

	if ( typeof value !== 'string' || ! value.startsWith( 'client:' ) ) return null;
	const id = value.slice( 'client:'.length );
	return loadClientProviders().find( p => p.id === id ) || null;

}

export function isClientModel( value ) {

	return typeof value === 'string' && value.startsWith( 'client:' );

}

/**
 * Fetch the list of available model ids from a provider (live).
 * OpenAI-compatible: GET <baseUrl>/models. Anthropic: GET <origin>/v1/models.
 * @param {{provider,wire,baseUrl,apiKey}} config
 * @returns {Promise<string[]>}
 */
export async function fetchProviderModels( config ) {

	const wire = config.wire || PROVIDER_PRESETS[ config.provider ]?.wire || 'openai';

	if ( wire === 'anthropic' ) {

		let url;
		try { url = new URL( config.baseUrl ).origin + '/v1/models'; } catch ( e ) { url = joinUrl( config.baseUrl, '/models' ); }
		const res = await fetch( url, { headers: {
			'x-api-key': config.apiKey || '',
			'anthropic-version': '2023-06-01',
			'anthropic-dangerous-direct-browser-access': 'true',
		} } );
		if ( ! res.ok ) throw new Error( await errorText( res ) );
		const data = await res.json();
		return ( data.data || [] ).map( m => m.id ).filter( Boolean );

	}

	const headers = {};
	if ( config.apiKey ) headers[ 'Authorization' ] = 'Bearer ' + config.apiKey;
	const res = await fetch( joinUrl( config.baseUrl, '/models' ), { headers } );
	if ( ! res.ok ) throw new Error( await errorText( res ) );
	const data = await res.json();
	return ( data.data || data.models || [] ).map( m => m.id || m.name ).filter( Boolean );

}

// ── The engine: direct browser → provider calls ────────────────────────────────

/**
 * Build a { stream, interrupt } pair for a client provider config.
 * `stream` matches the AIEngine external streamFn contract.
 * @param {{provider,wire,model,baseUrl,apiKey}} config
 */
export function makeClientEngine( config ) {

	let controller = null;

	const interrupt = () => { if ( controller ) { try { controller.abort(); } catch ( e ) {} } };

	const stream = async ( messages, opts = {} ) => {

		controller = new AbortController();
		const signal = controller.signal;
		const wire = config.wire || PROVIDER_PRESETS[ config.provider ]?.wire || 'openai';
		return wire === 'anthropic'
			? anthropicChat( config, messages, opts, signal )
			: openaiChat( config, messages, opts, signal );

	};

	return { stream, interrupt };

}

function joinUrl( base, path ) {

	return String( base || '' ).replace( /\/+$/, '' ) + path;

}

// Anthropic's Messages API only lives at `<origin>/v1/messages`. Normalise the
// stored base URL so a wrong/stale version segment (e.g. `/v2`) can't produce a
// 404 — which surfaces confusingly as a CORS error because 404s carry no
// Access-Control-Allow-Origin header.
function anthropicMessagesUrl( base ) {

	try {

		return new URL( base ).origin + '/v1/messages';

	} catch ( e ) {

		return joinUrl( base, '/messages' );

	}

}

// ── OpenAI-compatible (OpenAI, Ollama /v1, custom) ──────────────────────────────

async function openaiChat( config, messages, opts, signal ) {

	const wantStream = typeof opts.onToken === 'function';
	const headers = { 'Content-Type': 'application/json' };
	if ( config.apiKey ) headers[ 'Authorization' ] = 'Bearer ' + config.apiKey;

	const body = {
		model: config.model,
		messages,
		temperature: opts.temperature ?? 0.7,
		max_tokens: Math.max( opts.maxTokens ?? 0, 4096 ),
		stream: wantStream,
	};

	let res;
	try {

		res = await fetch( joinUrl( config.baseUrl, '/chat/completions' ), {
			method: 'POST', headers, body: JSON.stringify( body ), signal,
		} );

	} catch ( e ) {

		if ( e.name === 'AbortError' ) return '';
		throw new Error( `client API request failed (CORS or network): ${ e.message }` );

	}

	if ( ! res.ok ) throw new Error( await errorText( res ) );

	if ( wantStream && ( res.headers.get( 'content-type' ) || '' ).includes( 'text/event-stream' ) ) {

		return readSSE( res, signal, ( json, push ) => {

			const delta = json.choices?.[ 0 ]?.delta?.content;
			if ( delta ) push( delta );

		}, opts.onToken );

	}

	const data = await res.json().catch( () => ( {} ) );
	const answer = data.choices?.[ 0 ]?.message?.content || '';
	if ( opts.onToken ) opts.onToken( '', answer );
	return answer;

}

// ── Anthropic Messages API ──────────────────────────────────────────────────────

async function anthropicChat( config, messages, opts, signal ) {

	const wantStream = typeof opts.onToken === 'function';

	// Anthropic keeps the system prompt separate from the message list.
	const system = messages.filter( m => m.role === 'system' ).map( m => m.content ).join( '\n\n' );
	const chat = messages
		.filter( m => m.role !== 'system' )
		.map( m => ( { role: m.role === 'assistant' ? 'assistant' : 'user', content: String( m.content ) } ) );

	const headers = {
		'Content-Type': 'application/json',
		'x-api-key': config.apiKey || '',
		'anthropic-version': '2023-06-01',
		// Required to allow calling the Anthropic API directly from a browser.
		'anthropic-dangerous-direct-browser-access': 'true',
	};

	const body = {
		model: config.model,
		max_tokens: Math.max( opts.maxTokens ?? 0, 4096 ),
		temperature: opts.temperature ?? 0.7,
		stream: wantStream,
		messages: chat,
	};
	if ( system ) body.system = system;

	let res;
	try {

		res = await fetch( anthropicMessagesUrl( config.baseUrl ), {
			method: 'POST', headers, body: JSON.stringify( body ), signal,
		} );

	} catch ( e ) {

		if ( e.name === 'AbortError' ) return '';
		throw new Error( `client API request failed (CORS or network): ${ e.message }` );

	}

	if ( ! res.ok ) throw new Error( await errorText( res ) );

	if ( wantStream && ( res.headers.get( 'content-type' ) || '' ).includes( 'text/event-stream' ) ) {

		return readSSE( res, signal, ( json, push ) => {

			if ( json.type === 'content_block_delta' && json.delta?.type === 'text_delta' ) push( json.delta.text );

		}, opts.onToken );

	}

	const data = await res.json().catch( () => ( {} ) );
	const answer = Array.isArray( data.content ) ? data.content.map( c => c.text || '' ).join( '' ) : '';
	if ( opts.onToken ) opts.onToken( '', answer );
	return answer;

}

// ── Shared SSE reader ───────────────────────────────────────────────────────────
// `extract(json, push)` pulls the text delta out of one parsed SSE data payload.

async function readSSE( res, signal, extract, onToken ) {

	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buf = '', full = '';
	const push = ( delta ) => { if ( delta ) { full += delta; onToken( delta, full ); } };

	try {

		for ( ;; ) {

			const { value, done } = await reader.read();
			if ( done ) break;
			buf += decoder.decode( value, { stream: true } );

			let sep;
			while ( ( sep = buf.indexOf( '\n\n' ) ) >= 0 ) {

				const evt = buf.slice( 0, sep );
				buf = buf.slice( sep + 2 );

				for ( const rawLine of evt.split( '\n' ) ) {

					const line = rawLine.trim();
					if ( ! line.startsWith( 'data:' ) ) continue;
					const payload = line.slice( 5 ).trim();
					if ( ! payload || payload === '[DONE]' ) continue;
					let json;
					try { json = JSON.parse( payload ); } catch { continue; }
					if ( json.error ) throw new Error( json.error.message || String( json.error ) );
					extract( json, push );

				}

			}

		}

	} catch ( e ) {

		if ( e.name !== 'AbortError' ) throw e; // abort → return what we have

	}

	return full;

}

async function errorText( res ) {

	let detail = '';
	try {

		const data = await res.json();
		detail = data.error?.message || data.error || JSON.stringify( data );

	} catch ( e ) {

		detail = await res.text().catch( () => '' );

	}
	// A 404 from a chat endpoint almost always means the model id is unknown, not a
	// bad URL — point the user at the ⟳ Fetch button to list valid models.
	const hint = res.status === 404 ? ' (unknown model id? use the ⟳ Fetch button to list valid models)' : '';
	return `client API error HTTP ${ res.status }${ detail ? ' — ' + detail : '' }${ hint }`;

}

// ── Config dialog (compact modal) ───────────────────────────────────────────────

/**
 * Open the client-API configuration dialog.
 * @param {{ onSaved?:Function, mount?:HTMLElement }} deps
 * @returns {{ element:HTMLElement, close:Function }}
 */
export function openClientAPIDialog( deps = {} ) {

	const mount = deps.mount || document.body;

	const overlay = document.createElement( 'div' );
	Object.assign( overlay.style, {
		position: 'fixed', inset: '0', background: 'rgba(0,0,0,.5)', zIndex: 100000,
		display: 'flex', alignItems: 'center', justifyContent: 'center',
	} );

	const el = document.createElement( 'div' );
	Object.assign( el.style, {
		width: '420px', maxHeight: '82vh', overflowY: 'auto', background: '#1e1e1e',
		color: '#eee', border: '1px solid #444', borderRadius: '6px', padding: '14px',
		font: '12px/1.5 system-ui, sans-serif', boxShadow: '0 10px 34px rgba(0,0,0,.6)',
	} );
	overlay.appendChild( el );

	const close = () => { overlay.remove(); };
	overlay.addEventListener( 'mousedown', e => { if ( e.target === overlay ) close(); } );

	// The editor registers a document-level keydown handler (Sidebar.Settings.Shortcuts)
	// that preventDefaults Backspace and treats letter keys as tool shortcuts WITHOUT
	// checking the focused element. Keep those handlers away from the modal's inputs so
	// typing (and Backspace) works normally.
	overlay.addEventListener( 'keydown', e => { e.stopPropagation(); if ( e.key === 'Escape' ) close(); } );
	overlay.addEventListener( 'keyup', e => e.stopPropagation() );
	overlay.addEventListener( 'keypress', e => e.stopPropagation() );

	const h = document.createElement( 'div' );
	h.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;';
	h.innerHTML = '<strong>Client-side API (browser → provider)</strong>';
	const x = document.createElement( 'button' );
	x.textContent = '✕'; x.title = 'Close';
	x.style.cssText = 'background:none;border:none;color:#aaa;cursor:pointer;font-size:14px;';
	x.addEventListener( 'click', close );
	h.appendChild( x );
	el.appendChild( h );

	const note = document.createElement( 'div' );
	note.style.cssText = 'opacity:.7;margin-bottom:10px;';
	note.innerHTML = 'Calls the provider directly from the browser — no server needed. '
		+ 'Keys are stored in <code>localStorage</code> (readable by same-origin scripts) and '
		+ 'requests leave the device. The DEV-mode server proxy still works alongside this.';
	el.appendChild( note );

	// ── Saved providers list ──
	const listWrap = document.createElement( 'div' );
	listWrap.style.cssText = 'margin-bottom:10px;';
	el.appendChild( listWrap );

	function field( labelText, node ) {

		const row = document.createElement( 'label' );
		row.style.cssText = 'display:block;margin:6px 0;';
		const t = document.createElement( 'div' );
		t.textContent = labelText;
		t.style.cssText = 'opacity:.75;margin-bottom:2px;';
		row.append( t, node );
		return row;

	}

	function input( placeholder, type = 'text' ) {

		const i = document.createElement( 'input' );
		i.type = type; i.placeholder = placeholder; i.spellcheck = false;
		i.style.cssText = 'width:100%;box-sizing:border-box;background:#111;color:#eee;border:1px solid #444;border-radius:3px;padding:5px 7px;';
		return i;

	}

	// ── Form ──
	const form = document.createElement( 'div' );
	form.style.cssText = 'border-top:1px solid #333;padding-top:8px;';

	const providerSel = document.createElement( 'select' );
	providerSel.style.cssText = 'width:100%;box-sizing:border-box;background:#111;color:#eee;border:1px solid #444;border-radius:3px;padding:5px 7px;';
	for ( const [ key, p ] of Object.entries( PROVIDER_PRESETS ) ) {

		const o = document.createElement( 'option' );
		o.value = key; o.textContent = p.label;
		providerSel.appendChild( o );

	}

	const labelIn = input( 'optional display label' );
	const baseIn = input( 'base URL' );
	const keyIn = input( 'API key', 'password' );

	// ── Model: dropdown of presets/fetched + a "Custom…" escape hatch ──
	const CUSTOM_MODEL = '__custom__';
	const selectCss = 'width:100%;box-sizing:border-box;background:#111;color:#eee;border:1px solid #444;border-radius:3px;padding:5px 7px;';
	const modelSel = document.createElement( 'select' );
	modelSel.style.cssText = selectCss + 'flex:1;';
	const modelCustom = input( 'type a model id' );
	modelCustom.style.display = 'none';
	modelCustom.style.marginTop = '5px';

	const fetchModelsBtn = document.createElement( 'button' );
	fetchModelsBtn.type = 'button';
	fetchModelsBtn.textContent = '⟳';
	fetchModelsBtn.title = 'Fetch available models from this provider';
	fetchModelsBtn.style.cssText = 'background:#333;color:#eee;border:1px solid #555;border-radius:3px;padding:5px 10px;cursor:pointer;';

	const modelRow = document.createElement( 'div' );
	modelRow.style.cssText = 'display:flex;gap:6px;';
	modelRow.append( modelSel, fetchModelsBtn );

	const modelStatus = document.createElement( 'div' );
	modelStatus.style.cssText = 'opacity:.65;margin-top:3px;';

	const modelWrap = document.createElement( 'div' );
	modelWrap.append( modelRow, modelCustom, modelStatus );

	function toggleCustomModel() {

		const isCustom = modelSel.value === CUSTOM_MODEL;
		modelCustom.style.display = isCustom ? 'block' : 'none';
		if ( isCustom ) modelCustom.focus();

	}

	function setModelOptions( models, selected ) {

		const uniq = [ ...new Set( ( models || [] ).filter( Boolean ) ) ];
		modelSel.innerHTML = '';
		uniq.forEach( m => {

			const o = document.createElement( 'option' );
			o.value = m; o.textContent = m;
			modelSel.appendChild( o );

		} );
		const co = document.createElement( 'option' );
		co.value = CUSTOM_MODEL; co.textContent = 'Custom…';
		modelSel.appendChild( co );

		if ( selected && uniq.includes( selected ) ) {

			modelSel.value = selected; modelCustom.value = '';

		} else if ( selected ) {

			modelSel.value = CUSTOM_MODEL; modelCustom.value = selected;

		} else {

			modelSel.value = uniq[ 0 ] ?? CUSTOM_MODEL; modelCustom.value = '';

		}
		modelCustom.style.display = modelSel.value === CUSTOM_MODEL ? 'block' : 'none';

	}

	function currentModel() {

		return ( modelSel.value === CUSTOM_MODEL ? modelCustom.value : modelSel.value ).trim();

	}

	modelSel.addEventListener( 'change', toggleCustomModel );

	async function loadModelsFromProvider() {

		const preset = PROVIDER_PRESETS[ providerSel.value ];
		const cfg = {
			provider: providerSel.value,
			wire: preset.wire,
			baseUrl: ( baseIn.value || preset.baseUrl ).trim(),
			apiKey: keyIn.value.trim(),
		};
		modelStatus.textContent = 'Fetching models…';
		fetchModelsBtn.disabled = true;
		try {

			const models = await fetchProviderModels( cfg );
			if ( models.length === 0 ) {

				modelStatus.textContent = 'No models returned.';

			} else {

				const keep = currentModel();
				setModelOptions( models, keep );
				modelStatus.textContent = models.length + ' models available for this key.';

			}

		} catch ( e ) {

			modelStatus.textContent = 'Fetch failed — ' + e.message + ' (type the id manually below)';

		} finally {

			fetchModelsBtn.disabled = false;

		}

	}

	fetchModelsBtn.addEventListener( 'click', loadModelsFromProvider );

	let editingId = null;

	function applyPreset( selectedModel ) {

		const p = PROVIDER_PRESETS[ providerSel.value ];
		if ( ! baseIn.value || baseIn.dataset.preset === '1' ) { baseIn.value = p.baseUrl; baseIn.dataset.preset = '1'; }
		modelCustom.placeholder = 'e.g. ' + p.modelHint;
		setModelOptions( p.models || [], selectedModel || '' );
		modelStatus.textContent = '';

	}
	baseIn.addEventListener( 'input', () => { baseIn.dataset.preset = ''; } );
	providerSel.addEventListener( 'change', () => { baseIn.dataset.preset = '1'; baseIn.value = ''; applyPreset( '' ); } );

	// ── Stepped wizard layout: 1) provider  2) API key  3) model ──────────────
	const stepTitle = document.createElement( 'div' );
	stepTitle.style.cssText = 'font-weight:600;margin-bottom:8px;color:#8bf;';

	const step1 = document.createElement( 'div' );
	step1.append(
		field( 'Provider', providerSel ),
		field( 'Base URL', baseIn ),
		field( 'Label (optional)', labelIn ),
	);

	const step2 = document.createElement( 'div' );
	const keyNote = document.createElement( 'div' );
	keyNote.style.cssText = 'opacity:.65;margin-top:2px;';
	step2.append( field( 'API key', keyIn ), keyNote );

	const step3 = document.createElement( 'div' );
	step3.append( field( 'Model', modelWrap ) );

	form.append( stepTitle, step1, step2, step3 );

	// ── Footer ──
	const actions = document.createElement( 'div' );
	actions.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:12px;';

	const backBtn = document.createElement( 'button' );
	backBtn.type = 'button'; backBtn.textContent = '← Back';
	backBtn.style.cssText = 'background:#333;color:#eee;border:1px solid #555;border-radius:4px;padding:7px 12px;cursor:pointer;';

	const spacer = document.createElement( 'div' );
	spacer.style.flex = '1';

	const cancelBtn = document.createElement( 'button' );
	cancelBtn.type = 'button'; cancelBtn.textContent = 'Cancel';
	cancelBtn.style.cssText = 'background:#333;color:#eee;border:1px solid #555;border-radius:4px;padding:7px 12px;cursor:pointer;';

	const nextBtn = document.createElement( 'button' );
	nextBtn.type = 'button'; nextBtn.textContent = 'Next →';
	nextBtn.style.cssText = 'background:#2b6;color:#031;border:none;border-radius:4px;padding:7px 14px;cursor:pointer;font-weight:600;';

	const addBtn = document.createElement( 'button' );
	addBtn.type = 'button'; addBtn.textContent = 'Add to models';
	addBtn.style.cssText = 'background:#2b6;color:#031;border:none;border-radius:4px;padding:7px 14px;cursor:pointer;font-weight:600;';

	actions.append( backBtn, spacer, cancelBtn, nextBtn, addBtn );
	form.appendChild( actions );
	el.appendChild( form );

	let step = 1;

	function showStep( n ) {

		step = n;
		step1.style.display = n === 1 ? 'block' : 'none';
		step2.style.display = n === 2 ? 'block' : 'none';
		step3.style.display = n === 3 ? 'block' : 'none';
		stepTitle.textContent = `Step ${ n } of 3 · ${ [ 'Choose provider', 'API key', 'Choose model' ][ n - 1 ] }`;
		backBtn.style.display = n > 1 ? 'inline-block' : 'none';
		nextBtn.style.display = n < 3 ? 'inline-block' : 'none';
		addBtn.style.display = n === 3 ? 'inline-block' : 'none';

		const preset = PROVIDER_PRESETS[ providerSel.value ];
		keyNote.textContent = preset.needsKey
			? 'Required. Stored in localStorage on this device only.'
			: 'Optional for ' + preset.label + ' — leave blank for a local endpoint.';

	}

	function resetForm() {

		editingId = null;
		addBtn.textContent = 'Add to models';
		providerSel.value = 'openai';
		labelIn.value = ''; keyIn.value = '';
		baseIn.value = ''; baseIn.dataset.preset = '1';
		modelStatus.textContent = '';
		applyPreset( '' );
		showStep( 1 );

	}

	cancelBtn.addEventListener( 'click', resetForm );
	backBtn.addEventListener( 'click', () => showStep( Math.max( 1, step - 1 ) ) );

	nextBtn.addEventListener( 'click', async () => {

		if ( step === 1 ) { showStep( 2 ); keyIn.focus(); return; }
		if ( step === 2 ) {

			showStep( 3 );
			// Fetch the model list valid for THIS key so step 3 only offers real ids.
			await loadModelsFromProvider();

		}

	} );

	addBtn.addEventListener( 'click', () => {

		const model = currentModel();
		if ( ! model ) {

			if ( modelSel.value === CUSTOM_MODEL ) { modelCustom.focus(); modelCustom.style.borderColor = '#c44'; }
			else { modelSel.focus(); modelSel.style.borderColor = '#c44'; }
			return;

		}
		upsertClientProvider( {
			id: editingId,
			provider: providerSel.value,
			label: labelIn.value,
			model,
			baseUrl: baseIn.value,
			apiKey: keyIn.value,
		} );
		renderList();
		resetForm();
		if ( deps.onSaved ) deps.onSaved();

	} );

	function renderList() {

		listWrap.innerHTML = '';
		const list = loadClientProviders();
		if ( list.length === 0 ) {

			const empty = document.createElement( 'div' );
			empty.style.cssText = 'opacity:.55;padding:4px 0;';
			empty.textContent = 'No client providers yet. Add one below.';
			listWrap.appendChild( empty );
			return;

		}
		for ( const p of list ) {

			const row = document.createElement( 'div' );
			row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:5px 2px;border-top:1px solid #333;';
			const name = document.createElement( 'div' );
			name.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
			name.innerHTML = `<strong>${ escapeHtml( p.label ) }</strong>`
				+ `<span style="opacity:.6"> — ${ escapeHtml( p.model ) }${ p.apiKey ? ' 🔑' : '' }</span>`;
			const edit = document.createElement( 'button' );
			edit.textContent = '✎'; edit.title = 'Edit';
			edit.style.cssText = 'background:none;border:none;color:#8bf;cursor:pointer;';
			edit.addEventListener( 'click', () => {

				editingId = p.id;
				addBtn.textContent = 'Save changes';
				providerSel.value = p.provider;
				labelIn.value = p.label;
				baseIn.value = p.baseUrl; baseIn.dataset.preset = '';
				keyIn.value = p.apiKey;
				applyPreset( p.model );
				showStep( 1 );
				el.scrollTop = 0;

			} );
			const del = document.createElement( 'button' );
			del.textContent = '✕'; del.title = 'Remove';
			del.style.cssText = 'background:none;border:none;color:#f77;cursor:pointer;';
			del.addEventListener( 'click', () => {

				removeClientProvider( p.id );
				renderList();
				if ( deps.onSaved ) deps.onSaved();

			} );
			row.append( name, edit, del );
			listWrap.appendChild( row );

		}

	}

	function escapeHtml( s ) {

		return String( s ).replace( /[&<>"]/g, c => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ c ] ) );

	}

	renderList();
	resetForm();
	mount.appendChild( overlay );
	providerSel.focus();

	return { element: overlay, close };

}
