# Dev Mode: 3rd-Party API Integration

The editor now supports using external AI models via API in dev mode. This allows you to use Ollama (local) or OpenAI (cloud) instead of just the browser-based WebLLM models.

## Security

**API keys are never exposed.** The server implements strict security measures:

✅ **No Key Exposure**
  - API keys (`OPENAI_API_KEY`) stay server-side only
  - Never sent to client or logged
  - Never exposed in error messages or responses

✅ **Request Validation**
  - Content-Type validation (only application/json)
  - Request size limit (1MB max)
  - Model and messages parameter validation

✅ **Response Sanitization**
  - Error messages are generic (no API details leaked)
  - HTTP error responses don't expose service internals
  - Sensitive endpoints not exposed in model listing

✅ **Cache Prevention**
  - API responses never cached (`no-store, must-revalidate`)
  - Pragma and Expires headers for HTTP/1.0 compatibility
  - X-Content-Type-Options and X-Frame-Options headers

✅ **Timeouts**
  - 30-second timeout on external API calls
  - Prevents hanging connections
  - Graceful error handling on timeout

## Starting Dev Mode

```bash
# Option 1: Set environment variable
DEV=1 node server.js

# Option 2: Use --dev flag
node server.js --dev

# Option 3: Custom port
DEV=1 node server.js 8080
```

When dev mode is enabled, the console shows:
```
Serving docs/ at http://127.0.0.1:5500
✓ Dev mode enabled
  /api/models  — List available models (WebLLM + Ollama + OpenAI)
  /api/chat    — Proxy chat requests to local/remote APIs
  /api/health  — Check health of external services
  • Ollama:    http://127.0.0.1:11434 (optional)
  • OpenAI:    OPENAI_API_KEY env var (optional)
```

## Using Local Models (Ollama)

### 1. Install and Start Ollama

```bash
# macOS (via Homebrew)
brew install ollama
ollama serve

# Or download from ollama.ai
```

Ollama runs on `http://127.0.0.1:11434` by default.

### 2. Pull a Model

```bash
ollama pull llama2                    # ~4GB
ollama pull neural-chat              # ~4GB
ollama pull mistral                   # ~5GB
ollama pull codellama                 # Best for code
```

### 3. Use in Editor

In the shell REPL, get available models:

```javascript
const models = await getAvailableModels();
// Lists: WebLLM models + any Ollama models running locally
```

Ask a question to an Ollama model:

```javascript
await askExternal('ollama:codellama', 'Create a spinning torus in three.js');
// Response is printed to output
```

## Using Cloud Models (OpenAI)

### 1. Set API Key

```bash
export OPENAI_API_KEY="sk-..."
DEV=1 node server.js
```

### 2. Use in Editor

```javascript
await getAvailableModels();
// Now lists gpt-4, gpt-4-turbo, gpt-3.5-turbo

await askExternal('gpt-4', 'What are the coordinates of the red cube?');
```

## Using Claude (Anthropic)

### 1. Get API Key

- Go to [console.anthropic.com](https://console.anthropic.com)
- Sign up or log in
- Navigate to API keys section
- Create a new API key

### 2. Set API Key

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
DEV=1 node server.js
```

### 3. Use in Editor

```javascript
await getAvailableModels();
// Now lists claude-3-5-sonnet, claude-3-opus, claude-3-haiku

await askExternal('claude-3-5-sonnet-20241022', 'Generate a blue sphere with a reflection');
```

### Model Choices

- **claude-3-5-sonnet** - Best balance of speed & quality (recommended for code)
- **claude-3-opus** - Most capable, slower, higher cost
- **claude-3-haiku** - Fastest, cheapest, good for simple tasks

## API Endpoints

### GET /api/models

Lists all available models (WebLLM + external APIs).

**Response:**
```json
{
  "devMode": true,
  "models": [
    {
      "id": "Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC",
      "label": "Qwen2.5-Coder 1.5B (~1 GB)",
      "source": "webllm",
      "vram_required_MB": 1024
    },
    {
      "id": "ollama:codellama",
      "label": "codellama (Ollama)",
      "source": "ollama",
      "vram_required_MB": 4096,
      "endpoint": "http://127.0.0.1:11434"
    },
    {
      "id": "gpt-4",
      "label": "OpenAI GPT-4 (API)",
      "source": "openai",
      "vram_required_MB": 0,
      "endpoint": "https://api.openai.com/v1"
    }
  ]
}
```

### POST /api/chat

Send a chat request to any available model.

**Request:**
```json
{
  "model": "ollama:codellama",
  "messages": [
    { "role": "user", "content": "Write a hello world program" }
  ],
  "temperature": 0.7,
  "max_tokens": 2000
}
```

**Response** (Ollama format):
```json
{
  "model": "codellama",
  "created_at": "2024-06-07T10:30:00Z",
  "message": {
    "role": "assistant",
    "content": "Here's a hello world program:\n\nprintf(\"Hello, World!\\n\");"
  },
  "done": true
}
```

### GET /api/health

Check the status of external services.

**Response:**
```json
{
  "status": "ok",
  "devMode": true,
  "services": {
    "ollama": "running",
    "openai": "configured"
  }
}
```

## Shell Functions

### getAvailableModels()

Fetch and display all available models.

```javascript
const data = await getAvailableModels();
// Prints table of models
// Returns: { devMode, models: [...] }
```

### askExternal(model, question)

Ask a question to an external model.

```javascript
// Using Ollama
await askExternal('ollama:codellama', 'Create a red sphere');

// Using OpenAI
await askExternal('gpt-4', 'What objects are in the scene?');

// Using Claude
await askExternal('claude-3-5-sonnet-20241022', 'Generate a spiral staircase');

// Get response
const answer = await askExternal('ollama:neural-chat', 'Explain quantum computing');
```

### checkApiHealth()

Verify external services are running.

```javascript
await checkApiHealth();
// Prints: { status: 'ok', devMode: true, services: {...} }
```

## Examples

### Query an Ollama Model for Scene Analysis

```javascript
// Create a scene
const cube = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
cube.name = 'Test Cube';
editor.execute(new AddObjectCommand(editor, cube));

// Ask Ollama to describe it
await askExternal('ollama:neural-chat', 'In brief, how many objects are in the scene and what is the main geometry?');
```

### Use Multiple Models for Comparison

```javascript
// Get responses from different providers
const local = await askExternal('ollama:codellama', 'Is a CatmullRomCurve3 a curve or a surface?');
const openai = await askExternal('gpt-4', 'Is a CatmullRomCurve3 a curve or a surface?');
const claude = await askExternal('claude-3-5-sonnet-20241022', 'Is a CatmullRomCurve3 a curve or a surface?');
```

### Generate Code with Claude, Execute Locally

```javascript
// Use Claude 3.5 Sonnet (great at code generation)
const code = await askExternal('claude-3-5-sonnet-20241022', 'Create a blue cone that slowly rotates. Use BoxGeometry for the base.');
// Copy-paste the generated code into the REPL to run it
```

### Quick Prototyping: Ollama → Claude

```javascript
// 1. Start with fast local Ollama for ideation
await askExternal('ollama:neural-chat', 'What are fun 3D scene ideas?');

// 2. Use Claude for refined code generation
const finalCode = await askExternal('claude-3-5-sonnet-20241022', 'Generate a pyramid with 4 tiers using BoxGeometry');
```

## Configuration

### Environment Variables

```bash
# Enable dev mode
export DEV=1

# OpenAI API key
export OPENAI_API_KEY="sk-..."

# Anthropic (Claude) API key
export ANTHROPIC_API_KEY="sk-ant-..."

# Custom Ollama endpoint (optional)
export OLLAMA_ENDPOINT="http://192.168.1.100:11434"
```

### Server Options

```bash
# Port 5500 (default)
node server.js

# Custom port
node server.js 8080

# Dev mode with custom port
DEV=1 node server.js 3000

# Verbose (not yet supported, but can be added)
DEV=1 DEBUG=* node server.js
```

## Troubleshooting

### Ollama Not Connecting

```javascript
// Check health
await checkApiHealth();
// Should show: ollama: "running"

// If offline, start Ollama:
// In another terminal: ollama serve
```

### OpenAI API Errors

```javascript
// Check that API key is set
console.log(process.env.OPENAI_API_KEY ? 'Key set' : 'No key');

// Verify health
await checkApiHealth();
// Should show: openai: "configured"

// If errors, check OpenAI dashboard for quota/rate limits
```

### Models Not Appearing

```javascript
// Make sure dev mode is active
await getAvailableModels();
// devMode field should be true

// If starting server:
DEV=1 node server.js
// Should show "✓ Dev mode enabled"
```

### CORS Errors

If running editor and server on different ports, ensure CORS headers are set. The server already sets:
```
Cross-Origin-Resource-Policy: cross-origin
```

## Performance Tips

1. **Use smaller models for speed**: `ollama:neural-chat` is faster than `ollama:mistral`
2. **Batch requests**: Multiple small requests are often faster than one large request
3. **Use temperature carefully**: 
   - `0` for deterministic code generation
   - `0.7-1.0` for creative/varied responses
4. **Consider context length**: Ollama models have limits (usually 2048 tokens)

## Using Claude for 3D Modeling

### Why Claude for three.js?

- **Excellent code generation**: Understands three.js patterns and best practices
- **Complex scene generation**: Can handle multi-part geometry and positioning
- **Descriptive → Code**: Turns English descriptions into working three.js code
- **Refinement loops**: Good at iterating and improving code based on feedback

### Complete Workflow Example

```bash
# 1. Start with Claude configured
export ANTHROPIC_API_KEY="sk-ant-..."
DEV=1 node server.js
```

In the editor REPL:

```javascript
// Check Claude is available
const models = await getAvailableModels();
console.log(models.models.filter(m => m.source === 'anthropic'));

// Generate a kitchen scene with Claude
const kitchenScene = await askExternal(
  'claude-3-5-sonnet-20241022',
  `Create a kitchen scene in three.js with:
   - A rectangular table (brown) at y=1
   - 4 legs (dark brown cylinders)
   - A counter along the back wall (gray)
   - 3 cabinets above the counter (light wood)
   Use BoxGeometry for the table and cabinets, CylinderGeometry for legs.`
);

// Claude generates the code - copy and paste result into REPL
// (The response will be formatted JavaScript code you can run directly)
```

### Claude Strengths for 3D

**Modeling complex hierarchies:**
```javascript
await askExternal('claude-3-5-sonnet-20241022', `
  Create a car in three.js where:
  - Body is a stretched box (2, 1, 4) painted red
  - Wheels are cylinders (0.5 radius, 0.2 height) painted black
  - Positioned at the 4 corners
  - Everything is grouped under one "car" Group
  Use proper positioning and hierarchy (wheels as children of body group).
`);
```

**Generating procedural patterns:**
```javascript
await askExternal('claude-3-5-sonnet-20241022', `
  Create a checkered floor using repeated BoxGeometries:
  - 10x10 grid of squares
  - Alternating red and white colors
  - Each square 0.5 units wide
  - Use a for loop to generate them efficiently
`);
```

**Material and lighting setup:**
```javascript
await askExternal('claude-3-5-sonnet-20241022', `
  Set up professional 3D rendering with:
  - A DirectionalLight from top-left at (10, 20, 10)
  - An AmbientLight for general illumination
  - A MeshPhysicalMaterial on the main object with:
    - metalness = 0.8
    - roughness = 0.2
    - iridescence = 0.5
`);
```

### Performance Tips with Claude

1. **Be specific about geometry**: Name exact geometries (BoxGeometry, CylinderGeometry)
2. **Provide positioning**: Include y-coordinates, spacing, and layout
3. **Mention performance concerns**: If you need optimization for large scenes
4. **Ask for explanations**: Claude can explain three.js concepts if you ask

### Iterating with Claude

```javascript
// Generate initial version
let scene = await askExternal('claude-3-5-sonnet-20241022', 'Create a simple pyramid');

// Ask for improvements
let improved = await askExternal('claude-3-5-sonnet-20241022', `
  Improve the pyramid by:
  - Making it gold-colored with metallic shine
  - Adding a rotating animation (use Math.sin)
  - Centering it at origin
`);

// Further refinement
let final = await askExternal('claude-3-5-sonnet-20241022', `
  The pyramid code - add anti-aliasing and make the material more reflective
`);
```

## Switching Between APIs

The editor automatically discovers available APIs on startup:

1. WebLLM models are **always** available (run in browser)
2. If Ollama is running, add `ollama:*` models
3. If `OPENAI_API_KEY` is set, add `gpt-*` models

To switch:

```javascript
// List all available
const data = await getAvailableModels();

// Switch model select dropdown in UI
document.getElementById('shell-model-select').value = 'gpt-4';

// Or ask directly
await askExternal('ollama:codellama', 'Create a cylinder');
```

## Next Steps

- Integrate external models into the AI agentic loop (not just Q&A)
- Add support for more APIs (Anthropic Claude, Hugging Face, local llama.cpp)
- Implement streaming responses for better UX
- Add caching layer for identical queries
- Support custom model endpoints

## Security Best Practices

### API Key Management

**Never commit API keys to version control:**

```bash
# ✅ DO: Use environment variables
export OPENAI_API_KEY="sk-..."
DEV=1 node server.js

# ❌ DON'T: Embed keys in code or .env file (if committed)
const OPENAI_KEY = "sk-...";  // DANGEROUS!
```

**Secure your .env file:**

```bash
# Create .env file (if using one)
echo ".env" >> .gitignore
echo "OPENAI_API_KEY=sk-..." > .env

# Load it
set -a
source .env
set +a
DEV=1 node server.js
```

**Rotate keys regularly:**

- OpenAI: https://platform.openai.com/account/api-keys
- After key rotation, restart server immediately

### Request/Response Inspection

**The server sanitizes all API communication:**

1. **Request**: Client sends model ID + messages (no keys)
2. **Server**: Adds Authorization header server-side
3. **Response**: Returns model response only, never raw errors

**Example flow:**

```javascript
// Client request (safe)
{
  model: "gpt-4",
  messages: [{ role: "user", content: "hello" }]
}

// Server adds auth (secret, server-side only)
headers: {
  Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
}

// Client receives (safe)
{
  choices: [{ message: { content: "Hi there!" } }]
}
```

### Error Messages

**All error messages are generic to prevent information leakage:**

```javascript
// API error → Generic response
// "Invalid API key" → "Authentication failed"
// "Rate limit exceeded" → "Rate limited"
// "Service down" → "Service error"
```

### Running on Public Networks

**Dev mode should ONLY run on localhost:**

```bash
# ✅ SAFE: Listen only on localhost
node server.js  # Binds to 127.0.0.1:5500

# ❌ DANGEROUS: Listen on all interfaces
# (Don't do this with API keys!)
# Would need separate .listen('0.0.0.0', ...) code
```

**If you need remote access:**

1. Use SSH tunneling instead of exposing the server
2. Use a reverse proxy with authentication (nginx + oauth2-proxy)
3. Never expose `OPENAI_API_KEY` over unencrypted connections

### Audit Logging

**The server logs only errors (never keys):**

```javascript
console.error('[OpenAI Error]', e.message);  // ✅ Safe: error message only
console.error('[Parse Error]', e.message);   // ✅ Safe: error message only
// Never: console.log(process.env.OPENAI_API_KEY)  ❌
```

**To verify no keys are exposed:**

```bash
# Check server output
DEV=1 node server.js 2>&1 | grep -i "sk-"
# Should return nothing (no API keys logged)
```

### Network Monitoring

**If running on a network, inspect traffic:**

```bash
# Monitor without seeing content
tcpdump -i any 'port 5500' -l

# Never do: tcpdump with payload inspection
# (API keys could be visible in plaintext debugging)
```

---

**Note**: Dev mode is intended for development/testing. In production, use only browser-based WebLLM for privacy and no external API dependencies.
