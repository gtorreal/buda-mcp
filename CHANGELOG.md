# Changelog

All notable changes to `buda-mcp` are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).  
This project uses [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Added

- **`get_stable_liquidity`** — new tool that reports spread and orderbook-depth slippage for all stablecoin markets on Buda.com (USDT-CLP, USDC-CLP, USDT-PEN, USDC-PEN, USDT-COP, USDC-COP, USDT-USDC, and any future stablecoin markets). Markets are discovered dynamically. Slippage is computed by walking the live order book for five fixed USD notional sizes: 1k, 5k, 10k, 50k, and 100k. Returns `spread_pct`, `best_bid`, `best_ask`, and per-size `buy_pct`/`sell_pct`; `null` + `insufficient_liquidity: true` when order book depth is too thin for that size.
- 6 new unit tests for the `walkOrderbook` helper function (covers exact fill, multi-level walk, partial fill, thin book, empty book edge cases).

---

## [2.0.0] — 2026-04-11

### Breaking Changes

- **Public-only release.** All 18 authenticated/private API tools have been removed. No API key or `BUDA_API_SECRET` is accepted. This version works exclusively with Buda.com's public endpoints.
- Removed tools: `get_account_info`, `get_balance`, `get_balances`, `get_orders`, `get_order`, `get_order_by_client_id`, `place_order`, `cancel_order`, `cancel_all_orders`, `cancel_order_by_client_id`, `place_batch_orders`, `get_network_fees`, `get_deposit_history`, `create_fiat_deposit`, `get_withdrawal_history`, `create_withdrawal`, `list_receive_addresses`, `get_receive_address`, `create_receive_address`, `list_remittances`, `get_remittance`, `quote_remittance`, `accept_remittance_quote`, `list_remittance_recipients`, `get_remittance_recipient`, `lightning_withdrawal`, `create_lightning_invoice`, `schedule_cancel_all`, `renew_cancel_timer`, `disarm_cancel_timer`.
- `BudaClient` constructor no longer accepts `apiKey`/`apiSecret` parameters.
- HTTP server no longer requires or checks `MCP_AUTH_TOKEN`, `BUDA_API_KEY`, or `BUDA_API_SECRET`.
- `validateCryptoAddress` removed from `src/validation.ts`.
- Private-only types removed from `src/types.ts`.

### Retained (16 public tools)

`get_markets`, `get_ticker`, `get_orderbook`, `get_trades`, `get_market_volume`, `get_spread`, `compare_markets`, `get_price_history`, `get_arbitrage_opportunities`, `get_market_summary`, `simulate_order`, `calculate_position_size`, `get_market_sentiment`, `get_technical_indicators`, `get_real_quotation`, `get_available_banks`.

### Notes

The full version with authenticated tools is preserved in the `with-auth` branch.

---

## [Unreleased]

### Security

- **TLS startup warning for self-hosted HTTP deployments** — when `BUDA_API_KEY`/`BUDA_API_SECRET` are configured and `TRUST_PROXY_HOPS=0` (no proxy declared), the HTTP server now emits a startup warning that running over plain HTTP exposes credentials to network interception. Suppressible with `SKIP_TLS_CHECK=true` for localhost development. Railway deployments (`TRUST_PROXY_HOPS=1`) are unaffected.

### Operations

- **Continuous CI workflow** — `.github/workflows/ci.yml` runs `npm audit --audit-level=high`, build, and the full test suite on every push and pull request to `main`. Previously CI only ran on releases, so dependency vulnerabilities and regressions could go undetected between releases.

- **Dependabot enabled** — `.github/dependabot.yml` opens weekly pull requests for npm dependency updates (grouped into one PR) and GitHub Actions action hash updates. Covers the supply chain risk of the four runtime dependencies going stale.

- **Security disclosure policy** — `SECURITY.md` documents the private advisory channel (GitHub Security Advisories), a 48-hour acknowledgement SLA, coordinated disclosure commitment, and an explicit in/out-of-scope list. Prompt injection via API response content and the `confirmation_token` UX guard are explicitly listed as out of scope with rationale.

- **README Security section** — new section before the HTTP deployment docs explaining the stdio-first model, TLS requirement for HTTP self-hosting, the scope of `confirmation_token`, and a link to `SECURITY.md` for vulnerability reports.

### Security

- **BOLT-11 regex is now strictly lowercase** — the `i` (case-insensitive) flag was removed from the validation regex in `lightning_withdrawal`. Bech32 encoding is strictly lowercase; the flag was silently accepting uppercase invoice strings that the exchange would reject, giving false format-check confidence.

- **`isTokenEntropyOk` now uses Shannon entropy** — the bearer-token entropy check previously required only ≥ 8 distinct characters (`new Set(token).size >= 8`). Repeating patterns with exactly 8 distinct chars (e.g. `abcdefgh` × 4, log₂(8) = 3.0 bits/char) or UUID-style strings (~3.4 bits/char) passed despite being weak secrets. The check now computes Shannon entropy and requires ≥ 3.5 bits/char. Any `openssl rand -hex 32` output (~4.0 bits/char) comfortably passes; the startup error message is updated accordingly.

- **`validateCryptoAddress` surfaces a warning for unknown currencies** — the function previously returned `null` silently for currencies not in `ADDRESS_RULES` (e.g. SOL, ADA, MATIC), meaning no client-side address validation occurred before an irreversible crypto withdrawal. The return type is now `{ error: string | null; warning: string | null }`. An unknown currency returns `error: null, warning: "No local address format rule…"`. The `create_withdrawal` handler includes the warning in the success response payload so the caller (AI agent or operator) sees it before the funds leave.

- **Validation errors no longer reflect user input (prompt-injection fix)** — `validateMarketId` and `validateCurrency` previously embedded the raw caller-supplied string verbatim in their error messages (e.g. `Invalid market ID "${id}"`). An LLM-controlled caller could craft a `market_id` value that injects arbitrary text into the model's context. Both functions now return fixed, static error strings with no user data.

- **`trust proxy` hop count is now configurable via `TRUST_PROXY_HOPS`** — the Express `trust proxy` setting was hardcoded to `1`. If a second reverse-proxy layer is added (e.g. Cloudflare in front of Railway), clients can spoof `X-Forwarded-For` and bypass the IP-based rate limiter. The value is now read from the `TRUST_PROXY_HOPS` env var (default: `1`, range: 0–10) via `parseEnvInt`, which exits with a fatal error on invalid input.

- **`create_fiat_deposit` now emits audit logs** — `handleCreateFiatDeposit` was the only destructive handler that did not call `logAudit`. Both the success and failure paths now emit a structured audit event (tool, transport, currency, amount, success flag) consistent with all other financial operations.

- **API path stripped from client-facing error messages** — `BudaClient.handleResponse` previously included the URL path in the message forwarded to MCP callers (e.g. `"Buda API error 404 on /markets/btc-clp/orders."`). The path is an internal implementation detail and was an unnecessary information disclosure. Client messages are now path-free (`"Buda API error 404."`); the path continues to appear in the server-side `stderr` log.

- **`MCP_AUTH_TOKEN` entropy check added** — a new `isTokenEntropyOk(token)` helper (exported from `src/utils.ts`) requires at least 8 distinct characters in the token. Tokens like `"aaaa...a"` or simple keyboard runs pass the length check but have effectively zero entropy. The check runs at startup alongside the existing length guard and causes `process.exit(1)` on failure.

- **Lightning invoice length capped in handler and Zod schema** — the BOLT-11 regex upper bound was unbounded (`{20,}`); it is now `{20,1800}`. The Zod schema for `invoice` also gains `.max(2000)`. Real BOLT-11 invoices are a few hundred bytes; the old limit allowed a near-10 kb string to be forwarded to the Buda API.

- **Withdrawal `address` field length capped** — the `address` Zod field in `create_withdrawal` now enforces `.max(200)`. For unknown currencies (those not in `ADDRESS_RULES`) the handler passes through without format validation, so an unbounded string could previously reach the upstream API.

- **`gtd_timestamp` capped at 90 days in the future** — `place_order` validated that `gtd_timestamp` is a future datetime but imposed no upper bound. An LLM could hallucinate the year 9999, effectively creating a permanent GTC order. Values more than 90 days ahead now return `VALIDATION_ERROR`.

- **`cancel_order_by_client_id` handler enforces 255-char limit internally** — the Zod schema already capped `client_id` at 255 characters, but the exported handler function `handleCancelOrderByClientId` had no such check. A caller bypassing Zod (e.g. in tests or direct invocation) could supply an unbounded string. The handler now rejects `client_id.length > 255` before all other checks.

- **Nonce counter no longer wraps at 1000** — `BudaClient.nonce()` computed `Date.now() * 1000 + (this._nonceCounter++ % 1000)`. After 1000 calls within the same millisecond the modulo resets to 0, potentially producing a duplicate nonce and causing an HMAC authentication failure with the Buda API. The `% 1000` is removed; the counter now grows monotonically.

### Tests

- 75 new unit tests across 10 new security sections (+ 2 updated for new semantics). Total: 234 unit tests.
  - `L6 — Nonce counter uniqueness` (3 tests)
  - `L5 — cancel_order_by_client_id handler-level client_id length guard` (3 tests)
  - `L3 — place_order gtd_timestamp 90-day upper bound` (3 tests)
  - `L2 — Withdrawal address max length` (3 tests)
  - `L1 — Lightning invoice max length guard` (2 tests)
  - `M4 — isTokenEntropyOk: bearer token entropy check` (8 tests, updated for Shannon entropy threshold)
  - `H2 — TRUST_PROXY_HOPS range validation` (6 tests)
  - `H1 — validation error messages do not reflect user input` (4 tests)
  - `M1 — create_fiat_deposit audit logging` (3 tests)
  - `M2 — Error messages do not expose API path to callers` (3 tests)
  - `validateCryptoAddress` tests updated to assert `{ error, warning }` shape; unknown-currency warning path covered

---

## [1.5.6] – 2026-04-11

### Security

- **`Retry-After` delay capped at 30 s** — `BudaClient.parseRetryAfterMs` now applies `Math.min(secs * 1_000, 30_000)` before scheduling the 429-retry wait. Previously there was no upper bound: a response with `Retry-After: 99999` would make the client wait ~27 hours inside `fetchWithRetry`, effectively creating an unbounded denial-of-service for any caller awaiting that request. Negative values are also caught and fall back to 1 s.

- **`String(err)` leakage eliminated from all tool handlers** — a new `formatApiError(err)` helper (exported from `src/client.ts`) replaces 33 inline ternaries that previously forwarded raw `String(err)` to MCP callers. For unknown errors the internal detail (which may contain file paths, connection strings, or stack traces) is now written only to `stderr`; callers receive the generic message `"An unexpected error occurred. Check server logs."` with code `INTERNAL_ERROR`.

- **Caller IP now propagated into HTTP audit events** — `src/request-context.ts` introduces an `AsyncLocalStorage<{ ip? }>` store. The three `/mcp` Express handlers wrap their execution in `requestContext.run({ ip: req.ip }, ...)`, and `logAudit` reads the store automatically. All destructive-action audit entries now include the caller's IP for HTTP requests with no changes to individual tool handlers.

- **`MCP_AUTH_TOKEN` minimum length enforced at startup** — tokens shorter than 32 characters now cause `process.exit(1)` instead of a `console.warn`. This matches the existing fatal-error pattern for missing tokens and `PORT`/`MCP_RATE_LIMIT` out-of-range values.

- **`server` field removed from `/health` response** — the unauthenticated health endpoint previously included `server: "buda-mcp"`, enabling passive fingerprinting of the software. It now returns only `{ status: "ok" }`.

### Tests

- 11 new unit tests across 3 new sections: `Retry-After cap`, `formatApiError — error sanitization`, and `IP propagation in audit logs`. Total: 195 unit tests.

---

## [1.5.5] – 2026-04-11

### Security

- **Fetch timeout added to all Buda API calls** — `BudaClient.fetchWithRetry` now passes `AbortSignal.timeout(15_000)` to every `fetch` call (both the initial request and the 429-retry). Without a timeout, a hung upstream response held an Express worker open indefinitely, enabling a slow-response denial-of-service.

- **`auth_mode` removed from public `/health` response** — the unauthenticated health endpoint no longer reveals whether the server is running with live exchange credentials. Fingerprinting the deployment mode is now blocked for unauthenticated callers.

- **`client_id` length-capped in `cancel_order_by_client_id`** — the Zod schema now enforces `.max(255)` on the `client_id` parameter. Previously an unbounded string would be `encodeURIComponent`-encoded and forwarded directly into the URL path, potentially generating extremely long requests.

- **`client_id` now included in audit log for `cancel_order_by_client_id`** — both the success and error branches of `handleCancelOrderByClientId` previously wrote `args_summary: {}`, making the audit trail useless for this operation. The `client_id` is now recorded.

- **`bank` field length-capped in `create_fiat_deposit`** — the Zod schema now enforces `.max(100)` on the optional `bank` field, preventing an unbounded string from being forwarded to the Buda API.

- **`trust proxy` comment strengthened** — the inline comment now explicitly warns that adding a second proxy layer (e.g. Cloudflare) in front of Railway requires incrementing `trust proxy` to 2; failing to do so allows clients to spoof `X-Forwarded-For` and bypass the IP-based rate limiter.

---

## [1.5.4] – 2026-04-11

### Security

- **CI/CD supply-chain hardening** — `publish.yml` now verifies the SHA256 checksum of the `mcp-publisher` binary against the official `registry_*_checksums.txt` file before extraction. The download uses `curl -fsSL` (strict) and aborts if the checksum does not match. Previously the binary was piped directly from the network into `tar` without any integrity check.

- **GitHub Actions pinned to immutable commit SHAs** — all three `actions/checkout` and `actions/setup-node` usages in `publish.yml` are now pinned to their exact commit SHA (`11bd71901...` / `49933ea5...`) with the human-readable tag in a comment. Tag-based references (`@v4`) are mutable and could be silently redirected.

- **`DELETE /mcp` protected by rate limiter and auth middleware** — the endpoint was previously unprotected and returned 405 to anyone without any throttling. It now passes through the same `mcpRateLimiter` and `mcpAuthMiddleware` as the `POST`/`GET` `/mcp` handlers.

- **Version removed from unauthenticated `/health` response** — the `version` field was removed from the public health endpoint to prevent fingerprinting of the exact server version. `status`, `server`, and `auth_mode` are still returned.

- **`/.well-known/mcp/server-card.json` gated by auth when credentials are configured** — when `MCP_AUTH_TOKEN` is set, the server-card endpoint now requires the same Bearer token as `/mcp`, preventing unauthenticated enumeration of all tool schemas including authenticated ones.

- **`validateCurrency` added to `get_arbitrage_opportunities`** — the `base_currency` input was the only tool parameter that bypassed the shared currency validator. It now runs `validateCurrency()` before any business logic. The Zod schema in `register()` was also tightened with `.min(2).max(10).regex(/^[A-Z0-9]+$/i)`.

- **`network` field in `create_withdrawal` validated by regex** — the blockchain network identifier for crypto withdrawals is now validated against `/^[a-z][a-z0-9-]{1,29}$/` in the Zod schema, rejecting unexpected values before they reach the Buda API.

- **Audit log for `lightning_withdrawal` now includes amount** — `args_summary` was previously empty (`{}`), making the audit trail useless for this operation. The confirmed withdrawal amount (`amount_btc`) is now included so anomaly detection and post-incident review have meaningful context. The invoice string is still never logged.

- **`safeTokenEqual` now eliminates token-length timing oracle** — both strings are written into equal-length zero-padded `Buffer.alloc(maxLen)` before `timingSafeEqual`, so execution time no longer varies with the difference in string lengths. A final `aByteLen === bByteLen` guard prevents a padded match from returning `true`.

- **CORS policy documented explicitly** — an inline comment clarifies that CORS is intentionally not configured because `buda-mcp` is a server-to-server MCP transport, not a browser client target. `helmet()` already sets the relevant browser security headers.

---

## [1.5.3] – 2026-04-11

### Security

- **Upstream API errors no longer forwarded to MCP clients** — `BudaClient.handleResponse` now logs the full Buda API error detail (status, path, message) to `process.stderr` as structured JSON and returns only a generic message to the MCP caller (e.g. `"Buda API error 404 on /path."`). Previously, raw upstream error messages including potential internal details were forwarded directly to clients.

- **Audit log transport field corrected for HTTP** — nine destructive tool handlers (`place_order`, `cancel_order`, `cancel_all_orders`, `cancel_order_by_client_id`, `place_batch_orders`, `create_withdrawal`, `lightning_withdrawal`, `create_receive_address`, `quote_remittance`, `accept_remittance_quote`) now correctly log `transport: "http"` when invoked via the HTTP server. Previously their `register()` functions defaulted to `"stdio"`, making all HTTP audit events appear as stdio traffic.

- **HTTP security headers via `helmet`** — Express HTTP server now applies `helmet()` as the first middleware, adding `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `X-DNS-Prefetch-Control`, `X-Download-Options`, and removing `X-Powered-By`.

- **Request body size limit** — `express.json()` now enforces an explicit `limit: "10kb"` on the `/mcp` endpoint, reducing the memory/CPU surface for oversized body attacks in combination with the existing rate limiter.

- **Rate limiting extended to `/health` and `/.well-known/mcp/server-card.json`** — a `staticRateLimiter` (60 req/min) now protects these endpoints, which previously had no throttling. Sufficient for all legitimate uptime monitors and Smithery discovery.

- **`trust proxy` topology documented** — added inline comment to `app.set("trust proxy", 1)` explaining the single-hop assumption (Railway), the impact on `req.ip` and `express-rate-limit` client IP detection, and the action required if an additional proxy layer is added.

### Pending (manual)

- **CI binary pinning** — `publish.yml` should pin `mcp-publisher` to a fixed version with SHA256 verification instead of downloading `releases/latest`. Target version: `v1.5.0`, SHA256: `79bbb73ba048c5906034f73ef6286d7763bd53cf368ea0b358fc593ed360cbd5`. See `PUBLISH_CHECKLIST.md` for the exact step.

### Added

- `helmet` dependency (v8.x) — HTTP security headers middleware.

---

## [1.5.2] – 2026-04-11

### Security

- **Trust proxy configured for Railway** — added `app.set("trust proxy", 1)` to Express before any middleware. Without this, `express-rate-limit` saw the proxy IP for every request instead of the real client IP, making per-IP rate limiting effectively useless in the Railway deployment.

- **Constant-time bearer token comparison** — `mcpAuthMiddleware` now uses `crypto.timingSafeEqual` via a new `safeTokenEqual()` helper (exported from `src/utils.ts`) instead of plain string equality, eliminating the theoretical timing side-channel on the `MCP_AUTH_TOKEN` comparison.

- **PORT and MCP_RATE_LIMIT startup validation** — both environment variables are now parsed through a new `parseEnvInt(raw, fallback, min, max, name)` helper that throws a descriptive error and exits on `NaN` or out-of-range values, preventing silent misconfigurations (e.g. `MCP_RATE_LIMIT=abc` previously resolved to `NaN` and could disable the rate limiter).

- **MCP_AUTH_TOKEN entropy warning** — server now emits a `console.warn` at startup if `MCP_AUTH_TOKEN` is set but shorter than 32 characters, nudging operators toward adequately random secrets.

- **Dead man's switch fully isolated to stdio transport** — `renew_cancel_timer` and `disarm_cancel_timer` now also return `TRANSPORT_NOT_SUPPORTED` on HTTP transport (previously only `schedule_cancel_all` was blocked). An attacker with HTTP access could previously disarm or renew a timer armed via the stdio process, since both share the same module-level `timers` Map.

- **Input validation in `compare_markets`** — `base_currency` is now validated with `validateCurrency()` before fetching tickers, consistent with all other tools that accept a currency parameter. Arbitrary-length strings no longer reach the cache or API.

- **BOLT-11 invoice regex strengthened** — regex updated from `/^ln(bc|tb|bcrt)\d/i` to `/^ln(bc|tb|bcrt)\d*[munp]?1[a-z0-9]{20,}$/i`. The new pattern requires the bech32 separator `1`, at least 20 characters of bech32 data after it, and anchors at `$` — rejecting malformed strings that happen to start with the right prefix.

- **API path redaction from error responses** — removed the `path` field from all `BudaApiError` catch blocks across 31 tool handlers. The field was included in MCP tool responses, leaking internal API endpoint patterns (e.g. `/currencies/BTC/withdrawals`) to clients. The `path` property still exists on `BudaApiError` for internal use in audit logs.

- **Structured audit logging for destructive operations** — new `src/audit.ts` module with `logAudit(event: AuditEvent)` writes newline-delimited JSON to `process.stderr` for all 11 handlers with financial side-effects: `place_order`, `cancel_order`, `cancel_all_orders`, `cancel_order_by_client_id`, `place_batch_orders`, `create_withdrawal`, `lightning_withdrawal`, `create_receive_address`, `quote_remittance`, `accept_remittance_quote`, `schedule_cancel_all`. Audit events include `ts`, `tool`, `transport`, `args_summary` (sanitized — never includes `confirmation_token`, `invoice`, or `address`), `success`, and `error_code`. Each handler exposes an optional `transport` parameter (default `"stdio"`) for future HTTP-aware logging.

### Added

- **`safeTokenEqual(a, b)` utility** — exported from `src/utils.ts`; constant-time string comparison using `crypto.timingSafeEqual`. Usable by any future code that compares secrets.
- **`parseEnvInt(raw, fallback, min, max, name)` utility** — exported from `src/utils.ts`; safe environment variable integer parsing with range validation. Used for `PORT` and `MCP_RATE_LIMIT` at startup.
- **`handleCompareMarkets` exported handler** — `compare_markets.ts` logic extracted from the inline registration closure into a named, exported function for unit testability.

### Tests

- **+28 unit tests** covering all new security behaviors: `safeTokenEqual` (5 cases), `parseEnvInt` (6 cases), `handleCompareMarkets` validateCurrency guard (4 cases), improved BOLT-11 regex (3 cases), DMS HTTP transport guard for renew and disarm (4 cases), `logAudit` output format and secret redaction (3 cases), audit integration with `handlePlaceOrder` (1 case), `path` field absence in error responses (2 cases).
- **Updated 3 existing test fixtures** — replaced placeholder invoice string `"lnbc1000u1ptest..."` (which contained dots — invalid bech32) with a well-formed test value that satisfies the improved BOLT-11 regex.

---

## [1.5.1] – 2026-04-11

### Security

- **HTTP startup guard for missing `MCP_AUTH_TOKEN`** — when `BUDA_API_KEY`/`BUDA_API_SECRET` are present but `MCP_AUTH_TOKEN` is not set, the HTTP server now exits with a `FATAL` error at startup instead of silently leaving the `/mcp` endpoint publicly accessible. This closes the opt-in footgun where operators could deploy credentials without a protecting token.

- **Rate limiting on `/mcp`** — `express-rate-limit` middleware (120 req/min per IP by default) is applied to `POST /mcp` and `GET /mcp` before auth, preventing looping agents from saturating the Buda API. Configurable via the `MCP_RATE_LIMIT` environment variable.

- **Crypto address format validation in `create_withdrawal`** — the `address` field is now validated against per-currency regex rules for BTC, ETH, USDC, USDT, LTC, BCH, and XRP before any API call. Unknown currencies pass through to the exchange. Returns `INVALID_ADDRESS` on failure. Tool description now explicitly warns that crypto withdrawals are irreversible.

- **BOLT-11 invoice format validation in `lightning_withdrawal`** — the `invoice` field is now checked against a prefix regex (`/^ln(bc|tb|bcrt)\d/i`) before the API call, rejecting non-invoice strings (e.g. a Bitcoin address pasted by mistake). Zod minimum length tightened from 1 to 50 characters.

- **Dead man's switch blocked on HTTP transport** — `schedule_cancel_all` now returns `TRANSPORT_NOT_SUPPORTED` when called via the HTTP server, where a process restart (deploy, crash, autoscale) silently drops all in-memory timers. `renew_cancel_timer` and `disarm_cancel_timer` remain callable. The `register()` function accepts a new `transport: "stdio" | "http"` parameter (default `"stdio"`).

### Added

- **Batch orders optional notional cap** — `place_batch_orders` now accepts an optional `max_notional` parameter. If the sum of `amount × limit_price` across all limit orders exceeds the cap, the entire batch is rejected before any API call with `NOTIONAL_CAP_EXCEEDED`. Market orders contribute 0 (execution price unknown).

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
- **Marketplace docs updated** — `gemini-tools.json`, `claude-listing.md`, `openapi.yaml`, and `README.md` updated to reflect all changes.
- **Marketplace documentation gap** — `claude-listing.md`, `gemini-tools.json`, and `openapi.yaml` were missing 18 tools that were already implemented and registered in the server. All three files now reflect the full set of 46 tools.

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
