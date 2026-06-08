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

		// Desired context window. Qwen2.5 supports far more than the 4096 the
		// prebuilt MLC config defaults to; a larger window gives the prompt + RAG +
		// retry history real headroom. Applied as an override at load, with fallback.
		this.desiredContextWindow = 8192;
		// Actual window in effect after load (override value, or conservative
		// fallback if the compiled model rejected the override).
		this.contextWindow = null;

	}

	/** True once a model has been loaded successfully. */
	get ready() { return this._engine !== null; }

	// ── Interrupt ─────────────────────────────────────────────────────────────
	/**
	 * Interrupt the in-flight generation. The active stream/complete call ends
	 * gracefully, resolving with whatever text was produced so far. Safe to call
	 * when nothing is running — it's a no-op.
	 */
	interrupt() {

		if ( this._engine && typeof this._engine.interruptGenerate === 'function' ) {

			this._engine.interruptGenerate();

		}

	}

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

		const engineCfg = {
			initProgressCallback: onProgress,
			appConfig: webllm.prebuiltAppConfig,
		};

		try {

			// Try the larger window first (3rd arg = per-chat ChatOptions override).
			try {

				this._engine = await webllm.CreateMLCEngine( modelId, engineCfg, {
					context_window_size: this.desiredContextWindow,
				} );
				this.contextWindow = this.desiredContextWindow;

			} catch ( err ) {

				// The compiled model lib may not accept a larger window (or uses a
				// sliding window). Fall back to the model's default config.
				if ( onProgress ) onProgress( { text: 'large context unavailable — using default window…', progress: 0 } );
				this._engine = await webllm.CreateMLCEngine( modelId, engineCfg );
				this.contextWindow = 4096; // conservative known-safe default

			}

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
	async stream( messages, { onToken, maxTokens = 600, temperature = 0.1, frequencyPenalty = 0.1, presencePenalty = 0 } = {} ) {

		if ( ! this._engine ) throw new Error( 'AIEngine: not initialised' );

		// A SMALL frequency penalty nudges against pathological token loops without
		// suppressing the legitimate repetition that real code needs (every object
		// repeats `editor.execute(new AddObjectCommand(...))`). presence_penalty is
		// kept at 0 — it punishes a token for appearing at all, which made the model
		// DROP the last added object. Runaway loops are bounded by max_tokens + the
		// "never spam near-duplicate objects" prompt rule instead.
		const chunks = await this._engine.chat.completions.create( {
			messages,
			temperature,
			max_tokens: maxTokens,
			frequency_penalty: frequencyPenalty,
			presence_penalty: presencePenalty,
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
	async complete( messages, { maxTokens = 600, temperature = 0.1, frequencyPenalty = 0.1, presencePenalty = 0 } = {} ) {

		if ( ! this._engine ) throw new Error( 'AIEngine: not initialised' );

		const reply = await this._engine.chat.completions.create( {
			messages,
			temperature,
			max_tokens: maxTokens,
			frequency_penalty: frequencyPenalty,
			presence_penalty: presencePenalty,
			stream: false,
		} );

		return reply.choices[ 0 ].message.content;

	}

}
