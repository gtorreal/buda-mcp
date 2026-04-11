# Changelog

All notable changes to `buda-mcp` are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).  
This project uses [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Fixed

- **Security: path traversal in MCP resource handlers** — `buda://ticker/{market}` and `buda://summary/{market}` resource handlers now call `validateMarketId` before interpolating the parameter into the API URL, preventing path traversal to unintended Buda API endpoints.
- **Security: bearer token auth for HTTP server** — `src/http.ts` now supports an optional `MCP_AUTH_TOKEN` environment variable. When set, all requests to `/mcp` must include `Authorization: Bearer <token>`. Health check and server-card endpoints remain public.
- **Bug: NaN propagation in `flattenAmount`** — now throws an explicit error on invalid amount strings instead of silently returning `NaN`.
- **Bug: nonce collision on concurrent HTTP requests** — `BudaClient` now uses a per-instance counter to guarantee unique nonces even when multiple requests land within the same millisecond.
- **Bug: `version.ts` crash on missing `package.json`** — `readFileSync` is now wrapped in `try/catch` with fallback `"unknown"` to prevent process crash in deployments without `package.json`.
- **Bug: incorrect PUT payload in `cancel_order` and `dead_mans_switch`** — body is now `{ order: { state: "canceling" } }` per Buda API Rails convention, matching `cancel_order_by_client_id` and `remittances`.
- **Bug: `ttl_seconds` bounds not enforced in `handleScheduleCancelAll`** — added explicit validation (10–300, integer) in the handler itself, independent of Zod schema; a negative TTL would previously have fired the timer immediately.
- **Bug: `gtd_timestamp` not validated in `place_order`** — now checks that the value is a valid ISO 8601 datetime and is in the future before sending it to the API.
- **Bug: `sma_50` returned incorrect partial average** — `get_technical_indicators` now returns `null` for `sma_50` (with an `sma_50_warning` field) when fewer than 50 candles are available, instead of silently computing an average over fewer points.
- **Security: `quote_remittance` now requires `confirmation_token="CONFIRM"`** — this tool is non-idempotent (each call creates a new remittance record); the confirmation guard prevents accidental or repeated invocations.
- **Security: `create_receive_address` now requires `confirmation_token="CONFIRM"`** — this tool is non-idempotent (each call generates a new blockchain address); the confirmation guard prevents accidental repeated calls.
- **Marketplace docs updated** — `gemini-tools.json`, `claude-listing.md`, `openapi.yaml`, and `README.md` updated to reflect the new `confirmation_token` requirement for `create_receive_address` and `quote_remittance`, and the nullable `sma_50` field.

### Fixed

- **Marketplace documentation gap** — `claude-listing.md`, `gemini-tools.json`, and `openapi.yaml` were missing 18 tools that were already implemented and registered in the server. All three files now reflect the full set of 46 tools:
  - Public tools added: `get_available_banks`, `get_real_quotation`
  - Auth tools added: `get_account_info`, `get_balance`, `get_order`, `get_order_by_client_id`, `get_network_fees`, `get_deposit_history`, `get_withdrawal_history`, `create_receive_address`, `list_receive_addresses`, `get_receive_address`, `list_remittance_recipients`, `get_remittance_recipient`, `list_remittances`, `quote_remittance`, `accept_remittance_quote`, `get_remittance`
  - `openapi.yaml` bumped to version `1.4.0` (was `1.3.0`) and expanded from 14 to 16 paths, adding `get_available_banks` and `get_real_quotation` with full response schemas.

---

## [1.5.0] – 2026-04-11

### Added

- **`cancel_all_orders`** (`src/tools/cancel_all_orders.ts`) — auth-gated tool to cancel all open orders in a specific market or across all markets (`market_id="*"`). Confirmation guard fires before market validation or API call. Uses new `DELETE /orders` endpoint via `client.delete<T>()`. Exports `handleCancelAllOrders` for unit testing.

- **`cancel_order_by_client_id`** (`src/tools/cancel_order_by_client_id.ts`) — auth-gated tool to cancel an open order by its client-assigned string ID (`PUT /orders/by-client-id/{client_id}`). Confirmation guard first; returns the same flat order shape as `get_order`. Exports `handleCancelOrderByClientId` for unit testing.

- **`place_batch_orders`** (`src/tools/batch_orders.ts`) — auth-gated tool to place up to 20 orders sequentially. Pre-validates **all** orders (market ID format + `limit_price` presence) before any API call — a single validation failure aborts with zero orders placed. API failures mid-batch do not roll back placed orders; a `warning` field surfaces this. Returns `{ results, total, succeeded, failed, warning? }`. Exports `handlePlaceBatchOrders` for unit testing.

- **`place_order` extended (optional TIF + stop fields)** — backward-compatible additions:
  - **Time-in-force flags**: `ioc` (immediate-or-cancel), `fok` (fill-or-kill), `post_only`, `gtd_timestamp` (ISO 8601 expiry). Mutually exclusive — specifying more than one returns `VALIDATION_ERROR`.
  - **Stop orders**: `stop_price` + `stop_type` (`">="` or `"<="`) — both must be present together or both absent, otherwise `VALIDATION_ERROR`.
  - All validation happens after the confirmation guard but before the API call.

- **`create_withdrawal`** (added to `src/tools/withdrawals.ts`) — auth-gated `POST /currencies/{currency}/withdrawals`. Supports crypto (via `address` + optional `network`) and fiat (via `bank_account_id`). Exactly one destination must be provided; both or neither → `VALIDATION_ERROR`. Confirmation guard preview includes `{ currency, amount, destination }`. Returns flat `Withdrawal` shape. Exports `handleCreateWithdrawal` and `createWithdrawalToolSchema`.

- **`create_fiat_deposit`** (added to `src/tools/deposits.ts`) — auth-gated `POST /currencies/{currency}/deposits`. Guard is critical — calling twice creates duplicate records. Validates currency before API call. Returns flat `Deposit` shape. Exports `handleCreateFiatDeposit` and `createFiatDepositToolSchema`.

- **`lightning_withdrawal`** + **`create_lightning_invoice`** (`src/tools/lightning.ts`) — two auth-gated Lightning Network tools:
  - `lightning_withdrawal` — pays a BOLT-11 invoice from the LN-BTC reserve (`POST /reserves/ln-btc/withdrawals`). Confirmation guard truncates the invoice in the preview (`invoice_preview: first 20 chars + "..."`). Returns `{ id, state, amount, amount_currency, fee, fee_currency, payment_hash, created_at }`.
  - `create_lightning_invoice` — creates a receive invoice (`POST /lightning_network_invoices`). No confirmation required. Inputs: `amount_satoshis`, optional `description` (max 140 chars), optional `expiry_seconds` (60–86400). Returns `{ id, payment_request, amount_satoshis, description, expires_at, state, created_at }`.

- **`delete<T>()` on `BudaClient`** (`src/client.ts`) — follows the same HMAC auth headers + 429 retry pattern as `put<T>()`. Supports optional query params.

- **New types** in `src/types.ts`: `CancelAllOrdersResponse`, `LightningWithdrawal`, `LightningWithdrawalResponse`, `LightningInvoice`, `LightningInvoiceResponse`.

- **Unit tests (32 new, 138 total)** in `test/unit.ts`:
  - `cancel_all_orders` (5 tests): no confirmation; `*` + CONFIRM; specific market + CONFIRM; invalid market with CONFIRM; 404 passthrough.
  - `cancel_order_by_client_id` (3 tests): no confirmation; happy path with flat order; 404 passthrough.
  - `place_batch_orders` (5 tests): no confirmation; all valid; invalid market pre-validation; missing limit_price pre-validation; mid-batch API error partial success.
  - `place_order extended` (4 tests): existing limit order unchanged; IOC → `limit.type='ioc'`; stop_price without stop_type; mutually exclusive TIF flags.
  - `create_withdrawal` (6 tests): no confirmation; both address+bank_account_id; neither; crypto path; fiat path; 422 passthrough.
  - `create_fiat_deposit` (4 tests): no confirmation; invalid currency; happy path; 422 passthrough.
  - `lightning_withdrawal` (3 tests): no confirmation with preview; happy path; 422 passthrough.
  - `create_lightning_invoice` (2 tests): happy path; 422 passthrough.

---

## [1.4.2] – 2026-04-11

### Added

- **Shorter candle periods** (`5m`, `15m`, `30m`) now supported in both `get_price_history` and `get_technical_indicators`. Previously only `1h`, `4h`, `1d` were available.
- **Lowered `MIN_CANDLES`** in `get_technical_indicators` from 50 to 20, matching the actual minimum required by the algorithms (RSI-14, MACD-26, BB-20). Individual indicators that still lack enough data return `null`.
- **Integration tests** now cover the full `get_technical_indicators` indicators branch using `5m` period (42 live candles from BTC-CLP). Previously only the `insufficient_data` branch was tested live.

---

## [1.4.1] – 2026-04-11

### Fixed

- **`simulate_order`**: `taker_fee` returned by Buda API is already expressed as a percentage (`0.8` = 0.8%), not a decimal. Dividing by 100 before use gives correct fee calculations. Previously this caused fee_amount and total_cost to be ~100× too large.
- Integration test (`test/run-all.ts`): added live checks for all 5 v1.4.0 tools; fixed field name `candles_available` (was `candles_used`).
- Unit test mocks: updated `taker_fee` mock values from `"0.008"`/`"0.005"` to `"0.8"`/`"0.5"` to match the real Buda API format.

---

## [1.4.0] – 2026-04-11

### Added

- **`simulate_order`** (`src/tools/simulate_order.ts`) — public tool that simulates a buy or sell order using live ticker and market data without placing a real order. Inputs: `market_id`, `side` (`buy`|`sell`), `amount`, optional `price` (omit for market order). Fetches ticker (cached) + market info (cached) in parallel to determine fill price, fee rate, and slippage. Uses the actual `taker_fee` from the market (0.8% crypto / 0.5% stablecoin). All responses include `simulation: true`. Exports `handleSimulateOrder` for unit testing.

- **`calculate_position_size`** (`src/tools/calculate_position_size.ts`) — public tool for Kelly-style position sizing from capital, risk %, entry price, and stop-loss. Fully client-side — no API calls. Infers `side` (`buy`/`sell`) from the stop vs entry relationship. Validates that stop ≠ entry. Returns `units`, `capital_at_risk`, `position_value`, `fee_impact` (0.8% conservative taker), and a plain-text `risk_reward_note`. Exports `handleCalculatePositionSize` for unit testing.

- **`get_market_sentiment`** (`src/tools/market_sentiment.ts`) — public tool computing a composite sentiment score (−100 to +100) from three weighted components: price variation 24h (40%), volume vs 7-day daily average (35%), bid/ask spread vs market-type baseline (25%). Spread baseline: 1.0% for crypto pairs, 0.3% for stablecoin pairs (USDT/USDC/DAI/TUSD). Returns `score`, `label` (`bearish`/`neutral`/`bullish`), `component_breakdown`, `data_timestamp`, and a `disclaimer`. Exports `handleMarketSentiment` for unit testing.

- **`get_technical_indicators`** (`src/tools/technical_indicators.ts`) — public tool computing RSI (14), MACD (12/26/9), Bollinger Bands (20, 2σ), SMA 20, and SMA 50 from Buda trade history. No external math libraries — all algorithms implemented inline. Uses at least 500 trades (minimum enforced). Returns signal interpretations: RSI overbought/oversold/neutral, MACD bullish/bearish crossover/neutral, BB above/below/within bands. Returns a structured `{ indicators: null, warning: "insufficient_data" }` object when fewer than 50 candles are available. Includes `disclaimer` field. Exports `handleTechnicalIndicators` for unit testing.

- **`schedule_cancel_all` + `renew_cancel_timer` + `disarm_cancel_timer`** (`src/tools/dead_mans_switch.ts`) — three auth-gated tools implementing an in-memory dead man's switch. `schedule_cancel_all` requires `confirmation_token="CONFIRM"`, `ttl_seconds` (10–300), and a `market_id`; arms a `setTimeout` that fetches all pending orders and cancels each one if not renewed. `renew_cancel_timer` resets the countdown for a market (no confirmation). `disarm_cancel_timer` clears the timer without cancelling orders (no confirmation). **WARNING: timer state is lost on server restart — not suitable for hosted deployments (e.g. Railway). Use only on locally-run instances.** Timer state is module-level and persists across HTTP requests within a process. Exports `handleScheduleCancelAll`, `handleRenewCancelTimer`, `handleDisarmCancelTimer` for unit testing.

- **`src/utils.ts` — `aggregateTradesToCandles(entries, period)`** — shared utility extracted from `get_price_history` logic. Takes raw Buda trade entries and a period string (`1h`/`4h`/`1d`), returns sorted `OhlcvCandle[]`. Used by both `get_price_history` and `get_technical_indicators`.

- **`src/types.ts` — `OhlcvCandle` interface** — exported for use across tools.

- **Unit tests (24 new, 59 total)** in `test/unit.ts`:
  - **i. `simulate_order`** (5 tests): market buy fills at min_ask; market sell fills at max_bid; limit order_type_assumed; stablecoin 0.5% fee; invalid market_id.
  - **j. `calculate_position_size`** (4 tests): buy scenario; sell scenario; stop == entry error; invalid market_id.
  - **k. `get_market_sentiment`** (5 tests): disclaimer present; neutral label; bullish on strong positive variation; bearish on strong negative variation; invalid market_id.
  - **l. `get_technical_indicators`** (4 tests): `aggregateTradesToCandles` OHLCV correctness; insufficient candles warning; sufficient candles with correct RSI signal; invalid market_id.
  - **m. `schedule_cancel_all`** (6 tests): CONFIRM guard; invalid market_id; CONFIRM activates + expires_at; renew with no timer; disarm with no timer (no-op); disarm after arm clears timer.

### Changed

- **`src/tools/price_history.ts`** — refactored to use the new shared `aggregateTradesToCandles()` from `utils.ts`. Behaviour is identical.

---

## [1.3.0] – 2026-04-11

### Added

- **`src/utils.ts`** — shared `flattenAmount(amount: Amount)` helper (returns `{ value: number, currency: string }`) and `getLiquidityRating(spreadPct: number)` helper (`"high"` / `"medium"` / `"low"`) used across multiple tools and unit-testable in isolation.

- **`get_arbitrage_opportunities`** (`src/tools/arbitrage.ts`) — new public tool that detects cross-country price discrepancies for a given asset across Buda's CLP, COP, and PEN markets, normalised to USDC. Inputs: `base_currency` (e.g. `"BTC"`) and optional `threshold_pct` (default `0.5`). Algorithm: fetches all tickers, converts each local price to USDC via the current USDC-CLP / USDC-COP / USDC-PEN rates, computes all pairwise discrepancy percentages, filters by threshold, and sorts descending. Output includes a `fees_note` reminding callers that Buda's 0.8% taker fee per leg (~1.6% round-trip) must be deducted. Exports `handleArbitrageOpportunities` for unit testing.

- **`get_market_summary`** (`src/tools/market_summary.ts`) — new public tool that returns a single unified object with everything relevant about a market: `last_price`, `last_price_currency`, `bid`, `ask`, `spread_pct`, `volume_24h`, `volume_24h_currency`, `price_change_24h`, `price_change_7d`, and `liquidity_rating` (`"high"` when spread < 0.3%, `"medium"` when 0.3–1%, `"low"` when > 1%). Makes 2 API calls in parallel (ticker + volume); spread is derived from the ticker without a third call. Exports `handleMarketSummary` for unit testing.

- **`buda://summary/{market}`** MCP Resource — registered in both stdio (`src/index.ts`) and HTTP (`src/http.ts`) transports. Returns the same JSON as `get_market_summary`. Added to the server-card `resources` array.

- **Unit tests (12 new, 35 total)** in `test/unit.ts`:
  - **f. Numeric flattening** (4 tests): `flattenAmount` returns a `number`, not a string; handles decimals and zero correctly; result is not an array.
  - **g. `get_arbitrage_opportunities`** (3 tests): mocked tickers verify correct USDC-normalised discrepancy calculation (~3.95% for BTC CLP vs PEN at the given rates); threshold 5% correctly excludes the opportunity; returns `isError` when fewer than 2 markets have USDC rates.
  - **h. `get_market_summary` / `getLiquidityRating`** (5 tests): boundary tests for all three liquidity tiers; end-to-end mock verifies `liquidity_rating: "high"` at 0.2% spread and that `last_price` is a number type.

### Changed

- **Flat response schemas across all tools** — every tool that previously returned Buda `[amount_string, currency_string]` tuples now returns flat, typed fields. All numeric strings are cast to `parseFloat`; the currency is separated into a `_currency`-suffixed sibling field. Specific changes per tool:
  - **`get_ticker`** — `last_price`, `min_ask`, `max_bid`, `volume` flattened; `price_variation_24h` / `price_variation_7d` cast to float.
  - **`get_market_volume`** — all four `*_volume_*` Amount fields flattened with `_currency` suffix.
  - **`get_orderbook`** — bids and asks converted from `[price, amount]` tuples to `{ price: float, amount: float }` objects.
  - **`get_trades`** — entries converted from `[timestamp_ms, amount, price, direction]` tuples to `{ timestamp_ms: int, amount: float, price: float, direction: string }` objects.
  - **`get_spread`** — `best_bid`, `best_ask`, `spread_absolute`, `last_price` → floats; `spread_percentage` → float (the "%" suffix is dropped); `currency` renamed to `price_currency`.
  - **`compare_markets`** — per-market `last_price` + `last_price_currency` (was `last_price` + `currency`); `best_bid`, `best_ask`, `volume_24h` → floats; `price_change_*` → floats in percent (was strings like `"1.23%"`).
  - **`get_price_history`** — OHLCV candle fields `open`, `high`, `low`, `close`, `volume` → floats (were strings).
  - **`get_balances`** — all four Amount fields per balance entry (`amount`, `available_amount`, `frozen_amount`, `pending_withdraw_amount`) flattened with `_currency` suffix.
  - **`get_orders`** — all Amount fields (`limit`, `amount`, `original_amount`, `traded_amount`, `total_exchanged`, `paid_fee`) flattened; `limit` renamed to `limit_price` / `limit_price_currency`.

- **Improved tool descriptions** — all 12 tool descriptions (10 public + 2 auth) rewritten to be specific about return shape, include units, and give a concrete example question an LLM might ask.

- **`package.json`** version bumped to `1.3.0`.
- **`marketplace/`** and **`PUBLISH_CHECKLIST.md`** updated to reflect v1.3.0 changes.

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
