# Changelog

All notable changes to `buda-mcp` are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).  
This project uses [Semantic Versioning](https://semver.org/).

---

## [1.2.0] – 2026-04-11

### Added

- **`src/validation.ts`** — new `validateMarketId` helper that enforces `/^[A-Z0-9]{2,10}-[A-Z0-9]{2,10}$/i` on all market ID inputs before URL interpolation. Returns a structured `isError: true` response with a helpful message on failure. Applied to all tools that accept `market_id`.
- **`.env.example`** — documents `BUDA_API_KEY` and `BUDA_API_SECRET` with comments and a link to the Buda token management page. Referenced in the README auth section.
- **`scripts/sync-version.mjs`** — reads `package.json` version and writes it to `server.json`. Run via `npm run sync-version` to keep the MCP registry manifest in sync after a version bump.
- **`test/unit.ts`** — 23 unit tests (no live API required):
  - **HMAC signing** (3 tests): exact output verified for GET (no body) and POST (with base64 body); determinism check.
  - **Cache deduplication** (3 tests): concurrent `getOrFetch` calls share the same in-flight promise; expiry triggers a new fetch; rejected fetcher clears the entry so the next call retries.
  - **confirmation_token guard** (4 tests): `place_order` and `cancel_order` return `isError: true` without `"CONFIRM"`.
  - **Input sanitization** (9 tests): malformed market IDs (path traversal, no hyphen, empty, oversized segments, special characters) all return a validation error; valid IDs (uppercase, lowercase, USDC) pass.
  - **429 retry** (4 tests): mock 429→200 asserts fetch is called exactly twice and the 200 data is returned; double-429 asserts `BudaApiError` with `retryAfterMs`; `Retry-After: 2` header parsed as 2000 ms (RFC 7231 seconds); absent header defaults to 1000 ms.
- **`npm run test:unit`** and **`npm run test:integration`** scripts for running test subsets independently.

### Changed

- **Single version source-of-truth** — all version references now derive from `package.json` at startup:
  - `src/version.ts` (new shared module): reads `package.json` via `readFileSync` + `fileURLToPath`.
  - `src/client.ts`, `src/index.ts`, `src/http.ts` import `VERSION` from `src/version.ts`.
  - `server.json` is kept in sync via `npm run sync-version`.
- **`http.ts` server-card generated programmatically** — the `/.well-known/mcp/server-card.json` endpoint now assembles tool schemas from each tool module's exported `toolSchema` constant instead of a 100-line hardcoded JSON block. Adding a tool only requires exporting its `toolSchema`.
- **All tool files** export a `toolSchema` constant `{ name, description, inputSchema }` used by both `register()` and the server-card endpoint, ensuring descriptions are always in sync.
- **`place_order.ts` and `cancel_order.ts`** expose their handler logic via exported `handlePlaceOrder` / `handleCancelOrder` functions, used by the register wrapper and directly testable in unit tests.
- **`get_price_history`** improvements:
  - Shallow-window limitation moved to the **front** of the description (was buried in a `note` field).
  - UTC bucket boundary format documented explicitly in tool description and `note` field.
  - `limit` max raised from `100` to `1000`; description updated accordingly.
- **429 retry with Retry-After** — `BudaClient.get`, `.post`, and `.put` now retry once on a 429 response. The `Retry-After` header is parsed as integer seconds (per RFC 7231; Buda's docs describe 429 but do not document the header — the standard interpretation applies). Defaults to 1 second if the header is absent. A double-429 throws `BudaApiError` with `retryAfterMs` set.
- **`test/run-all.ts`** — integration tests now perform a 3-second connectivity pre-check at startup and skip gracefully (exit 0 with a message) when the Buda API is unreachable, preventing CI failures on networks without internet access.
- **`package.json`** version bumped to `1.2.0`.
- **`marketplace/`** and **`PUBLISH_CHECKLIST.md`** updated to reflect v1.2.0 changes.

---

## [1.1.2] – 2026-04-10

### Fixed

- **`get_price_history` OHLCV open/close reversed**: Buda returns trades newest-first; entries
  are now sorted ascending by timestamp before candle aggregation so `open` is the
  chronologically first price and `close` is the chronologically last price in each bucket.
- **Cache double-fetch race condition**: `MemoryCache.getOrFetch` now deduplicates concurrent
  requests for the same expired/missing key by storing the in-flight `Promise` and returning it
  to all concurrent callers instead of spawning a second fetch.
- **`User-Agent` version string**: corrected from `buda-mcp/1.1.0` to `buda-mcp/1.1.1` (and now `1.1.2`).

---

## [1.1.1] – 2026-04-10

### Fixed

- `server.json` version corrected to `1.1.1` (was stuck at `1.0.0`, breaking MCP Registry sync).
- npm package name corrected from `@gtorreal/buda-mcp` to `@guiie/buda-mcp` in README, marketplace files, and PUBLISH_CHECKLIST.md.

---

## [1.1.0] – 2026-04-10

### Added

**Phase 1: New public tools**

- **`get_spread`** — calculates the bid/ask spread (absolute and as a percentage of the ask price) for any market using the ticker endpoint. Cached with the same 5-second TTL as tickers.
- **`compare_markets`** — receives a base currency (e.g. `BTC`) and returns side-by-side ticker data for all its pairs across CLP, COP, PEN, USDC, and BTC quote currencies. Uses `GET /tickers` (all-tickers endpoint).
- **`get_price_history`** — returns OHLCV (open/high/low/close/volume) candles for a market and period (`1h`, `4h`, `1d`). Buda has no native candlestick endpoint; candles are aggregated client-side from up to 100 raw trades fetched via the trades endpoint.

**Input validation and error handling**

- All tools now wrap their handlers in `try/catch` and return structured `{ error, code, path }` JSON with `isError: true` on failure, instead of letting unhandled exceptions propagate.
- Zod schemas on all tool inputs remain the primary validation layer.

**In-memory TTL caching** (`src/cache.ts`)

- New `MemoryCache` class with `getOrFetch<T>(key, ttlMs, fetcher)` pattern.
- TTLs: markets list = 60 s, tickers = 5 s, order books = 3 s.
- Shared singleton for stdio; per-request instance for the stateless HTTP transport.

**Phase 2: Authentication scaffold**

- **`BudaClient`** extended with optional `apiKey` / `apiSecret` constructor params.
- `hasAuth()` method returns true when both env vars are set.
- HMAC-SHA384 signing implemented per [Buda API auth docs](https://api.buda.com/en/#authentication): nonce (microseconds), sign string `{METHOD} {path.json?query} {base64body} {nonce}`, headers `X-SBTC-APIKEY`, `X-SBTC-NONCE`, `X-SBTC-SIGNATURE`.
- `post<T>()` and `put<T>()` methods added to `BudaClient` for private endpoints.
- Credentials are read from `BUDA_API_KEY` / `BUDA_API_SECRET` environment variables. If not set, server runs in **public-only mode** — no breaking change for existing users.

**Authenticated tools** (only registered when API keys are present)

- **`get_balances`** — all currency balances (`GET /balances`).
- **`get_orders`** — orders for a given market, filterable by state (`GET /markets/{id}/orders`).
- **`place_order`** — places a limit or market order (`POST /markets/{id}/orders`). Requires `confirmation_token="CONFIRM"` to prevent accidental execution from ambiguous prompts.
- **`cancel_order`** — cancels an order by ID (`PUT /orders/{id}`). Requires `confirmation_token="CONFIRM"`.

**Phase 3: DX improvements**

- **MCP Resources protocol**: two resources registered in both stdio and HTTP transports:
  - `buda://markets` — JSON list of all markets (60 s cache).
  - `buda://ticker/{market}` — JSON ticker for a specific market (5 s cache).
- **README** rewritten: npx quick-start, npm/license/node badges, per-tool example prompts, authentication mode documentation, resources section.
- **`CHANGELOG.md`** introduced (this file).
- **`PUBLISH_CHECKLIST.md`** added with steps and message templates for notifying mcp.so and Glama.ai of the v1.1.0 release.
- **`marketplace/`** files updated: `claude-listing.md`, `cursor-mcp.json`, `gemini-tools.json`, `openapi.yaml` all reflect new tools, auth mode, npx quick-start, and MCP Resources.

### Changed

- `BudaClient` `User-Agent` header updated from `buda-mcp/1.0.0` to `buda-mcp/1.1.0`.
- All 5 existing tool `register()` functions updated to accept a `MemoryCache` parameter and apply TTL caching.
- Server version string in `McpServer`, `http.ts` health endpoint, and server-card JSON updated to `1.1.0`.
- `package.json` version bumped to `1.1.0`.
- `marketplace/cursor-mcp.json` npm package name corrected to `@gtorreal/buda-mcp`.
- `marketplace/claude-listing.md` npm package name corrected to `@gtorreal/buda-mcp`.

### Security

- API credentials (`BUDA_API_KEY`, `BUDA_API_SECRET`) are never logged at any level. All `console.log` / `console.error` calls in `http.ts` and `client.ts` were audited to confirm this.
- Authenticated instances are documented as **local-only** — never to be exposed publicly.

---

## [1.0.0] – 2025-01-01

### Added

- Initial release: 5 public MCP tools for Buda.com market data.
  - `get_markets` — list all trading pairs or get details for one.
  - `get_ticker` — current price, bid/ask, volume, and price change.
  - `get_orderbook` — full order book with bid/ask levels.
  - `get_trades` — recent trade history with pagination.
  - `get_market_volume` — 24h and 7-day volume by side.
- Dual transports: **stdio** (`index.ts`) and **Streamable HTTP** (`http.ts`).
- Railway deployment with health check at `GET /health`.
- Smithery-compatible static server card at `GET /.well-known/mcp/server-card.json`.
- Published to npm as `@gtorreal/buda-mcp`.
- Registered on MCP Registry as `io.github.gtorreal/buda-mcp`.
- Listed on Smithery, mcp.so, Glama.ai, PulseMCP, and awesome-mcp-servers.
