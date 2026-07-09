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
		this._externalAPIReady = false;  // Flag for external API mode
		this._externalStream = null;    // Override stream() for external APIs
		this._externalInterrupt = null; // Override interrupt() for external APIs

		// Desired context window. Qwen2.5 supports far more than the 4096 the
		// prebuilt MLC config defaults to; a larger window gives the prompt + RAG +
		// retry history real headroom. Applied as an override at load, with fallback.
		// 8192 was too tight: a labeled ~30-part asset's system prompt + ADDRESSABLE
		// PARTS injection + scene summary already reaches ~8.4k tokens, overflowing
		// the small on-device models before they can emit a single op. 16384 clears
		// that headroom (Qwen2.5-Coder natively supports 32k).
		this.desiredContextWindow = 16384;
		// Actual window in effect after load (override value, or conservative
		// fallback if the compiled model rejected the override).
		this.contextWindow = null;

		// ── Cost tracking for external APIs ────────────────────────────────────
		this._usage = {
			promptTokens: 0,
			completionTokens: 0,
			totalTokens: 0,
			estimatedCost: 0, // USD
			requestCount: 0,
		};

		// Token pricing (USD per 1K tokens) for common external APIs
		// Update as needed for your providers
		this._pricing = {
			// Anthropic Claude models (current versions)
			'claude-haiku-4-5-20251001': { input: 0.00025, output: 0.00125 },
			'claude-sonnet-4-20250514': { input: 0.003, output: 0.015 },
			'claude-opus-4-1-20250805': { input: 0.015, output: 0.075 },
			// Anthropic Claude models (legacy naming)
			'claude-3-5-sonnet': { input: 0.003, output: 0.015 },
			'claude-3-opus': { input: 0.015, output: 0.075 },
			'claude-3-haiku': { input: 0.00025, output: 0.00125 },
			// OpenAI models
			'gpt-4o': { input: 0.005, output: 0.015 },
			'gpt-4-turbo': { input: 0.01, output: 0.03 },
			'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
		};

	}

	/** True once a model has been loaded successfully (WebLLM or external). */
	get ready() { return this._engine !== null || this._externalAPIReady; }

	// ── Interrupt ─────────────────────────────────────────────────────────────
	/**
	 * Interrupt the in-flight generation. The active stream/complete call ends
	 * gracefully, resolving with whatever text was produced so far. Safe to call
	 * when nothing is running — it's a no-op.
	 */
	interrupt() {

		// External API interrupt (if overridden)
		if ( this._externalInterrupt ) {
			this._externalInterrupt();
			return;
		}

		// WebLLM interrupt
		if ( this._engine && typeof this._engine.interruptGenerate === 'function' ) {

			this._engine.interruptGenerate();

		}

	}

	// ── Unload ────────────────────────────────────────────────────────────────
	/**
	 * Release the currently loaded model so a different one can be loaded. Frees
	 * the WebLLM engine's GPU buffers / worker (or clears the external-API
	 * override) and resets ready state. Safe to call when nothing is loaded.
	 */
	async unload() {

		// External API mode: just drop the overrides.
		this._externalAPIReady = false;
		this._externalStream = null;
		this._externalInterrupt = null;

		// WebLLM engine: release GPU/worker resources.
		if ( this._engine ) {

			try {

				if ( typeof this._engine.unload === 'function' ) await this._engine.unload();

			} finally {

				this._engine = null;

			}

		}

		this.modelId = null;
		this.contextWindow = null;
		this.loading = false;

	}

	// ── Cost tracking ─────────────────────────────────────────────────────────
	/**
	 * Track API usage (tokens, cost). Called automatically when external APIs return responses.
	 * @param {number} promptTokens
	 * @param {number} completionTokens
	 */
	_trackUsage( promptTokens = 0, completionTokens = 0 ) {

		this._usage.promptTokens += promptTokens;
		this._usage.completionTokens += completionTokens;
		this._usage.totalTokens += promptTokens + completionTokens;
		this._usage.requestCount += 1;

		// Calculate cost if pricing available for this model
		const rate = this._pricing[ this.modelId ];
		if ( rate ) {
			const inputCost = ( promptTokens / 1000 ) * rate.input;
			const outputCost = ( completionTokens / 1000 ) * rate.output;
			this._usage.estimatedCost += inputCost + outputCost;
		}

	}

	/**
	 * Get current usage stats.
	 * @returns {Object} { promptTokens, completionTokens, totalTokens, estimatedCost, requestCount }
	 */
	getUsage() {

		return { ...this._usage };

	}

	/**
	 * Check if using external API (vs local WebLLM).
	 * @returns {boolean}
	 */
	isExternal() {

		return this._externalAPIReady;

	}

	/**
	 * Format usage stats as a human-readable string.
	 * @returns {string}
	 */
	formatUsage() {

		const u = this._usage;
		const isExternal = this.isExternal();
		
		// Show cost for external API, show $0.00 for local
		let costStr = isExternal
			? ` ($${u.estimatedCost.toFixed(4)})`
			: ' ($0.00)';
		
		// Add (est) only for non-zero external costs
		if ( isExternal && u.estimatedCost > 0 ) {
			costStr += ' (est)';
		}

		const reqLabel = u.requestCount === 1 ? 'request' : 'requests';

		return `${u.requestCount} ${reqLabel} • ${u.totalTokens} tokens${costStr}`;

	}

	/**
	 * Reset usage tracking (e.g., start of new session).
	 */
	resetUsage() {

		this._usage = {
			promptTokens: 0,
			completionTokens: 0,
			totalTokens: 0,
			estimatedCost: 0,
			requestCount: 0,
		};

	}

	/**
	 * Set pricing for a custom model.
	 * @param {string} modelId
	 * @param {number} inputRate USD per 1K input tokens
	 * @param {number} outputRate USD per 1K output tokens
	 */
	setPricing( modelId, inputRate, outputRate ) {

		this._pricing[ modelId ] = { input: inputRate, output: outputRate };

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
	 * Returns a Promise that resolves to the full response string (or { text, usage } for external APIs).
	 *
	 * @param {Array}    messages
	 * @param {Object}   [opts]
	 * @param {Function} [opts.onToken]    (delta, fullSoFar) called for each token
	 * @param {number}   [opts.maxTokens]
	 * @param {number}   [opts.temperature]
	 * @param {Function} [opts.onUsage]    (usage) called if token counts available
	 */
	async stream( messages, { onToken, maxTokens = 600, temperature = 0.1, frequencyPenalty = 0.1, presencePenalty = 0, schema = null, onUsage } = {} ) {

		// External API stream (if overridden)
		if ( this._externalStream ) {
			const result = await this._externalStream( messages, { onToken, maxTokens, temperature, schema, onUsage } );
			// If external API passed usage, track it
			if ( result && result.usage ) {
				this._trackUsage( result.usage.prompt_tokens || 0, result.usage.completion_tokens || 0 );
				if ( onUsage ) onUsage( this.getUsage() );
			}
			// Return full object with { text, usage } for external APIs so callers can access usage
			return result;
		}

		if ( ! this._engine ) throw new Error( 'AIEngine: not initialised' );

		// A SMALL frequency penalty nudges against pathological token loops without
		// suppressing the legitimate repetition that real code needs (every object
		// repeats `editor.execute(new AddObjectCommand(...))`). presence_penalty is
		// kept at 0 — it punishes a token for appearing at all, which made the model
		// DROP the last added object. Runaway loops are bounded by max_tokens + the
		// "never spam near-duplicate objects" prompt rule instead.
		const req = {
			messages,
			temperature,
			max_tokens: maxTokens,
			frequency_penalty: frequencyPenalty,
			presence_penalty: presencePenalty,
			stream: true,
		};
		// Constrained decoding (the 'constrained' eval condition): WebLLM/XGrammar
		// enforces schema-valid JSON so malformed op output is impossible.
		if ( schema ) req.response_format = { type: 'json_object', schema: JSON.stringify( schema ) };

		const chunks = await this._engine.chat.completions.create( req );

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
	 * @param {Array}    messages
	 * @param {Object}   [opts]
	 * @param {Function} [opts.onUsage]    (usage) called if token counts available
	 */
	async complete( messages, { maxTokens = 600, temperature = 0.1, frequencyPenalty = 0.1, presencePenalty = 0, schema = null, onUsage } = {} ) {

		// External API stream (if overridden) — use it for complete too
		if ( this._externalStream ) {
			const result = await this._externalStream( messages, { maxTokens, temperature, schema, onUsage } );
			// If external API passed usage, track it
			if ( result && result.usage ) {
				this._trackUsage( result.usage.prompt_tokens || 0, result.usage.completion_tokens || 0 );
				if ( onUsage ) onUsage( this.getUsage() );
			}
			return typeof result === 'string' ? result : ( result.text || result );
		}

		if ( ! this._engine ) throw new Error( 'AIEngine: not initialised' );

		const req = {
			messages,
			temperature,
			max_tokens: maxTokens,
			frequency_penalty: frequencyPenalty,
			presence_penalty: presencePenalty,
			stream: false,
		};
		if ( schema ) req.response_format = { type: 'json_object', schema: JSON.stringify( schema ) };

		const reply = await this._engine.chat.completions.create( req );

		return reply.choices[ 0 ].message.content;

	}

	// ── External API support ──────────────────────────────────────────────────
	/**
	 * Set up external API mode. Call this to configure aiEngine for Ollama/OpenAI/Claude.
	 * @param {string}   modelId        External model identifier (e.g. "claude-3-5-sonnet-...")
	 * @param {Function} streamFn       async function(messages, opts) that returns full response
	 * @param {Function} interruptFn    function() for interrupt
	 */
	setExternalAPI( modelId, streamFn, interruptFn ) {

		this.modelId = modelId;
		this.contextWindow = 8192;
		this._externalStream = streamFn;
		this._externalInterrupt = interruptFn;
		this._externalAPIReady = true;

		// Optionally set pricing if model is recognized
		if ( ! this._pricing[ modelId ] ) {
			console.warn( `AIEngine: pricing not configured for model "${modelId}" — cost tracking will be unavailable` );
		}

	}

	/**
	 * Clear external API mode (e.g., when switching models).
	 */
	clearExternalAPI() {

		this._externalAPIReady = false;
		this._externalStream = null;
		this._externalInterrupt = null;

	}

}
