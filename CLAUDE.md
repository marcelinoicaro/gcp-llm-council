# CLAUDE.md - Technical Notes for GCP LLM Council

This file contains technical details, architectural decisions, and important implementation notes for future development sessions.

## Project Overview

GCP LLM Council (a fork of karpathy/llm-council running on Vertex AI) is a 3-stage deliberation system where multiple LLMs collaboratively answer user questions. The key innovation is anonymized peer review in Stage 2, preventing models from playing favorites.

## Architecture

### Backend Structure (`backend/`)

**`config.py`**
- Contains `COUNCIL_MODELS` (Vertex AI model identifiers, `publisher/model[@location]`, overridable via `.env`)
- Contains `CHAIRMAN_MODEL` (model that synthesizes final answer) and `TITLE_MODEL` (small model that titles conversations)
- `MODEL_TIMEOUT_SECONDS` (default 600): per-call timeout; Stage 2 is the slowest because every member reads all responses
- Uses `GCP_PROJECT_ID` / `GCP_LOCATION` from `.env`; auth is Application Default Credentials (no API keys)
- `GCP_IMPERSONATE_SERVICE_ACCOUNT` (recommended): `vertex.py` wraps ADC in `google.auth.impersonated_credentials` so every Vertex call runs as the app's service account (only `roles/aiplatform.user`); `/api/config` → `vertex.identity` shows who the app calls as
- Everything model-related is overridable in `.env` (see `.env.example`); the defaults in `config.py` are the reference council
- Backend runs on **port 8001** (NOT 8000 - user had another app on 8000)

**`vertex.py`**
- `anthropic/*` models go through `anthropic.AsyncAnthropicVertex`; all others through Vertex's OpenAI-compatible `/endpoints/openapi/chat/completions`
- ADC quota project is pinned to `GCP_PROJECT_ID`
- `query_model()`: Single async model query
- `query_models_parallel()`: Parallel queries using `asyncio.gather()`
- Returns dict with 'content' and optional 'reasoning_details'
- Graceful degradation: returns None on failure, continues with successful responses

**`council.py`** - The Core Logic
- `stage1_collect_responses()`: Parallel queries to all council models
- `stage2_collect_rankings()`:
  - Anonymizes responses as "Response A, B, C, etc."
  - Creates `label_to_model` mapping for de-anonymization
  - Prompts models to evaluate and rank (with strict format requirements)
  - Returns tuple: (rankings_list, label_to_model_dict)
  - Each ranking includes both raw text and `parsed_ranking` list
- `stage3_synthesize_final()`: Chairman synthesizes from all responses + rankings
- `parse_ranking_from_text()`: Extracts "FINAL RANKING:" section, handles both numbered lists and plain format
- `calculate_aggregate_rankings()`: Computes average rank position across all peer evaluations

**`storage.py`**
- JSON-based conversation storage in `data/conversations/` (dir 0700, files 0600)
- `get_conversation_path()` only accepts canonical UUIDs (defense in depth against path traversal)
- Each conversation: `{id, created_at, messages[]}`
- Assistant messages contain: `{role, stage1, stage2, stage3}`
- Note: metadata (label_to_model, aggregate_rankings) is NOT persisted to storage, only returned via API

**`main.py`**
- FastAPI app bound to **127.0.0.1:8001** only (never 0.0.0.0)
- `TrustedHostMiddleware` (localhost/127.0.0.1) blocks DNS rebinding; CORS limited to localhost:5173/3000, GET/POST, no credentials
- `conversation_id` path params are typed `uuid.UUID`; `content` is 1..`MAX_MESSAGE_CHARS` (default 20000)
- Global rate limit `MAX_MESSAGES_PER_MINUTE` (default 5) on the paid message endpoints; 429 when exceeded
- Streaming errors return a generic message; details go to the server log only
- POST `/api/conversations/{id}/message` returns metadata in addition to stages
- Metadata includes: label_to_model mapping and aggregate_rankings

### Backend additions

- `settings.py`: runtime council settings (members, chairman, title model) edited from the UI, persisted to `data/settings.json` (0600); `.env`/`config.py` are the defaults. Validates `publisher/model[@location]` ids and 2..12 members. Holds `MODEL_CATALOG` (models shown in the settings screen).
- `council.py`: `run_council(query, settings, emit)` runs the 3 stages and calls `emit(event)` for `stageN_start/complete` and per member `member_start` / `member_done` (latency_ms, token usage). Returns `metadata` (council, chairman, label_to_model, aggregate_rankings, per-member stats, stage durations) which **is persisted** with the assistant message. `member_done` also carries the member's output (`content`, plus `parsed_ranking` in stage 2) and `cost_usd`, and `stage2_labels` sends `label_to_model` early, so the UI shows answers/evaluations as each member finishes. `metadata.cost` = estimated USD per stage and total.
- `pricing.py`: USD per 1M tokens per model (source: Cloud Billing Catalog API, Vertex AI service `C7E2-9256-1C43`, global endpoint, online, ≤200K context; dated in the file). `estimate_cost()` bills reasoning as output. Gemini (OpenAI-compatible endpoint) reports `completion_tokens_details.reasoning_tokens` **outside** `completion_tokens`; MaaS models and Claude include reasoning in output. `vertex.py` stores `usage.reasoning_tokens`. Extend with `PRICING_OVERRIDES` env (JSON). Models without a price show "sem preço" (e.g. Claude Haiku 5.5, not in the catalog).
- `stats.py`: aggregates stored metadata into per-model metrics (average rank, wins, median latency per stage, failures, tokens) for the dashboard.
- Endpoints: `GET/PUT/DELETE /api/config`, `POST /api/models/test` (own 20/min limit), `GET /api/stats`, `DELETE /api/conversations/{id}`. The stream endpoint runs the pipeline in a task and forwards events through an `asyncio.Queue`.

### Frontend Structure (`frontend/src/`)

Visual language: tokens from a **personal design system** (black page, grafite cards, neon `#7CFF01` accent, pill buttons, circles, 28px card radius, hard shadows, no gradients/emoji, Lucide icons at stroke 2.5, copy in pt-BR and always "AI", never "IA"). **No brand or third-party files are shipped**: fonts are open-license npm packages (`@fontsource/outfit` OFL, `@fontsource/permanent-marker` Apache-2.0), the app mark (`BrandMark`, "LC" disc) and the favicon are original SVGs, the sticker is CSS (`StickerLabel`), the hero texture is a CSS dot grid. Don't add the designer's logos, stickers, patterns or font files.

- `styles/tokens.css`: design tokens; fonts imported in `main.jsx` from `@fontsource`
- `ui/`: design-system primitives as CSS classes (`Button`, `IconButton`, `Badge`, `Card`, `Switch`, `Checkbox`, `Spinner`) plus original `BrandMark` and `StickerLabel`
- `App.jsx`: views (`chat` | `settings` | `dashboard`), conversation state and the SSE event reducer (`live` state on the streaming assistant message)
- `components/Sidebar.jsx`: brand, navigation, history with delete confirmation
- `components/ChatView.jsx`: hero + composer (council summary, char counter, example questions); single question per conversation
- `components/RunView.jsx`: live progress (3-step stepper, per-member status/latency/cost, elapsed time, running total cost; click a finished member to open its output), partial answers/evaluations in member tabs while slower members work, final answer, aggregate ranking, peer-review matrix, individual answers and full evaluations (tabs)
- `components/charts.jsx`: `RankDotPlot`, `PeerMatrix` (sequential neon ramp, self-review outlined, unparsed rankings flagged), `LatencyBars`; plain HTML with hover tooltips
- `components/SettingsView.jsx`: pick members from the catalog or add any Model Garden id, test models, choose chairman/title model, reset to defaults
- `components/DashboardView.jsx`: KPI tiles, average position per model, recent runs, per-model table
- `components/SafeMarkdown.jsx`: markdown for untrusted model output (no auto-loaded images), GFM enabled (`remark-gfm`: tables, strikethrough)
- `lib/cost.js`: cost helpers; the price table comes from `/api/config` → `pricing` (single source in `backend/pricing.py`)
- `api.js`: REST client + SSE reader that buffers partial chunks

## Key Design Decisions

### Stage 2 Prompt Format
The Stage 2 prompt is very specific to ensure parseable output:
```
1. Evaluate each response individually first
2. Provide "FINAL RANKING:" header
3. Numbered list format: "1. Response C", "2. Response A", etc.
4. No additional text after ranking section
```

This strict format allows reliable parsing while still getting thoughtful evaluations.

### De-anonymization Strategy
- Models receive: "Response A", "Response B", etc.
- Backend creates mapping: `{"Response A": "openai/gpt-5.1", ...}`
- Frontend displays model names in **bold** for readability
- Users see explanation that original evaluation used anonymous labels
- This prevents bias while maintaining transparency

### Error Handling Philosophy
- Continue with successful responses if some models fail (graceful degradation)
- Never fail the entire request due to single model failure
- Log errors but don't expose to user unless all models fail

### UI/UX Transparency
- All raw outputs are inspectable via tabs
- Parsed rankings shown below raw text for validation
- Users can verify system's interpretation of model outputs
- This builds trust and allows debugging of edge cases

## Important Implementation Details

### Relative Imports
All backend modules use relative imports (e.g., `from .config import ...`) not absolute imports. This is critical for Python's module system to work correctly when running as `python -m backend.main`.

### Port Configuration
- Backend: 8001 (changed from 8000 to avoid conflict)
- Frontend: 5173 (Vite default)
- Update both `backend/main.py` and `frontend/src/api.js` if changing

### Markdown Rendering
Render markdown with `SafeMarkdown` (never `ReactMarkdown` directly, never `rehype-raw`), wrapped in `<div className="markdown-content">`. This class is defined globally in `index.css`.

### Model Configuration
Defaults live in `backend/config.py` and are overridden by `.env`. IDs are `publisher/model[@location]`:
- `anthropic/*` → Anthropic SDK (`AsyncAnthropicVertex`)
- everything else → Vertex OpenAI-compatible endpoint
- many Model Garden MaaS models (DeepSeek, GLM, Qwen) are **global-endpoint only**; regional calls return "only available via global endpoint" or 404
- partner models (Claude, open models) must be enabled in Model Garden, and new projects may have **zero quota** for Claude (HTTP 429)
The chairman can be a council member or not; the default is `google/gemini-4-hydrogen`.

### Security Notes
See the hardening in `main.py`, `storage.py` and `SafeMarkdown.jsx` above. Keep the app local-only; if remote access is ever needed, add authentication first. Stage 1 outputs are inserted raw into Stage 2/3 prompts, so prompt injection between members is possible by design.

## Common Gotchas

1. **Module Import Errors**: Always run backend as `python -m backend.main` from project root, not from backend directory
2. **CORS Issues**: Frontend must match allowed origins in `main.py` CORS middleware
3. **Ranking Parse Failures**: If models don't follow format, fallback regex extracts any "Response X" patterns in order
4. **Missing Metadata**: Metadata is ephemeral (not persisted), only available in API responses
5. **ADC quota project**: local ADC may carry a `quota_project_id` from another GCP project; `vertex.py` pins it to `GCP_PROJECT_ID`
6. **Large councils are slow**: with ~10 members a question takes ~3-6 min and makes ~22 calls; raise `MODEL_TIMEOUT_SECONDS` if Stage 2 reviewers time out

## Future Enhancement Ideas

- Configurable council/chairman via UI instead of config file
- Streaming responses instead of batch loading
- Export conversations to markdown/PDF
- Model performance analytics over time
- Custom ranking criteria (not just accuracy/insight)
- Support for reasoning models (o1, etc.) with special handling

## Testing Notes

Before adding a model to the council, check it responds in your project (partner models need Model Garden enablement and quota). `infra/terraform` provisions the project (APIs, service account, optional budget).

There is no automated test suite. Verify changes by running the app and asking one question (it costs ~2N+2 model calls), or by posting to `/api/conversations/{id}/message/stream`. `npm run build` and `npm run lint` must pass clean.

## Data Flow Summary

```
User Query
    ↓
Stage 1: Parallel queries → [individual responses]
    ↓
Stage 2: Anonymize → Parallel ranking queries → [evaluations + parsed rankings]
    ↓
Aggregate Rankings Calculation → [sorted by avg position]
    ↓
Stage 3: Chairman synthesis with full context
    ↓
Return: {stage1, stage2, stage3, metadata}
    ↓
Frontend: Display with tabs + validation UI
```

The entire flow is async/parallel where possible to minimize latency.
