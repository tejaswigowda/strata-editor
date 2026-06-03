// ── WebLLM engine wrapper ─────────────────────────────────────────────────────
// Imports @mlc-ai/web-llm from CDN at module load so that
// prebuiltAppConfig.model_list is available immediately for populating the UI.
// Model WEIGHTS are only downloaded when init() is called.
// Caching is handled automatically by WebLLM via the browser's Cache Storage API.

import * as webllm from 'https://esm.run/@mlc-ai/web-llm';

/**
 * Returns the full WebLLM model registry.
 * Each entry has { model_id, vram_required_MB, ... }.
 */
export function getModelList() {

	return webllm.prebuiltAppConfig.model_list;

}

export class AIEngine {

	constructor() {

		this._engine  = null;
		this.loading  = false;
		this.modelId  = null;

	}

	/** True once a model has been loaded successfully. */
	get ready() { return this._engine !== null; }

	// ── Initialise ────────────────────────────────────────────────────────────
	/**
	 * Download (or load from cache) a model and warm up the engine.
	 * @param {string}   modelId       WebLLM model identifier
	 * @param {Function} onProgress    initProgressCallback(p) — p.text, p.progress (0–1)
	 */
	async init( modelId, onProgress ) {

		// If this model is already loaded, return immediately
		if ( this._engine !== null && this.modelId === modelId ) {

			if ( onProgress ) onProgress( { text: 'already loaded', progress: 1 } );
			return;

		}

		this.loading = true;

		try {

			this._engine = await webllm.CreateMLCEngine( modelId, {
				initProgressCallback: onProgress,
				appConfig: webllm.prebuiltAppConfig,
			} );

			this.modelId = modelId;

		} finally {

			this.loading = false;

		}

	}

	// ── Streaming inference ───────────────────────────────────────────────────
	/**
	 * Run inference with token-by-token streaming.
	 * Returns a Promise that resolves to the full response string.
	 *
	 * @param {Array}    messages
	 * @param {Object}   [opts]
	 * @param {Function} [opts.onToken]    (delta, fullSoFar) called for each token
	 * @param {number}   [opts.maxTokens]
	 * @param {number}   [opts.temperature]
	 */
	async stream( messages, { onToken, maxTokens = 600, temperature = 0.1 } = {} ) {

		if ( ! this._engine ) throw new Error( 'AIEngine: not initialised' );

		const chunks = await this._engine.chat.completions.create( {
			messages,
			temperature,
			max_tokens: maxTokens,
			stream: true,
		} );

		let full = '';

		for await ( const chunk of chunks ) {

			const delta = chunk.choices[ 0 ]?.delta?.content ?? '';
			full += delta;
			if ( onToken ) onToken( delta, full );

		}

		return full;

	}

	// ── Non-streaming inference ───────────────────────────────────────────────
	/**
	 * Run inference and return the full response as a single string.
	 * Used for retry correction passes where live display isn't needed.
	 */
	async complete( messages, { maxTokens = 600, temperature = 0.1 } = {} ) {

		if ( ! this._engine ) throw new Error( 'AIEngine: not initialised' );

		const reply = await this._engine.chat.completions.create( {
			messages,
			temperature,
			max_tokens: maxTokens,
			stream: false,
		} );

		return reply.choices[ 0 ].message.content;

	}

}
