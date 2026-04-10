# Changelog

All notable changes to `buda-mcp` are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).  
This project uses [Semantic Versioning](https://semver.org/).

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
