# PROJECT_MEMORY — buda-mcp

Operational knowledge, quirks, and context that doesn't belong in AGENTS.md or cursor rules.

## Stale documentation

These files still reference pre-2.0.0 auth behavior. Treat **code + CHANGELOG** as source of truth:

- `SECURITY.md` — version table says "Latest (1.x)", references `MCP_AUTH_TOKEN`, credential handling, HTTP auth model. All auth code was removed in v2.0.0.

## HTTP architecture

- **Stateless**: `src/http.ts` creates a new `McpServer` + fresh `MemoryCache` per request. No session state, `DELETE /mcp` returns 405.
- Rate limits: `/mcp` = 120 req/min/IP (configurable via `MCP_RATE_LIMIT`), static endpoints = 60 req/min.
- `TRUST_PROXY_HOPS` (default 1) must match the actual proxy chain. Wrong value breaks IP-based rate limiting.

## Buda API quirks

- **No native candlestick endpoint.** OHLCV candles in `get_price_history` and `get_technical_indicators` are aggregated client-side from raw trades.
- **`taker_fee` is already a percentage** (e.g. `0.8` = 0.8%), not a decimal. Do not divide by 100 again (see v1.4.1 fix).
- **Trades arrive newest-first.** Must sort ascending before candle aggregation (see v1.1.2 fix).
- **Arbitrage normalization** uses USDC rates (USDC-CLP, USDC-COP, USDC-PEN) to compare cross-country prices.

## CI/CD

- CI (`.github/workflows/ci.yml`): `npm ci` → `npm audit --audit-level=high` → build → test. Runs on push/PR to `main`.
- Publish (`.github/workflows/publish.yml`): triggered by GitHub Release tag. Publishes to MCP Registry via `mcp-publisher` binary (SHA256-verified).
- Dependabot: weekly grouped npm dependency PRs + Actions SHA pinning.

## Publishing

Full checklist in `PUBLISH_CHECKLIST.md`. Key steps:
1. Bump `package.json` → `npm run sync-version` → `npm test`
2. Update CHANGELOG, marketplace files
3. `npm publish --access public --provenance`
4. `gh release create vX.Y.Z` → triggers registry publish
5. Notify mcp.so and Glama.ai (templates in checklist)

## npm package

- Scoped as `@guiie/buda-mcp` (was `@gtorreal/buda-mcp` before v1.1.1)
- MCP Registry ID: `io.github.gtorreal/buda-mcp`
- Listed on: Smithery, mcp.so, Glama.ai, PulseMCP, awesome-mcp-servers

## Testing notes

- Unit tests use `tsx` directly (excluded from `tsc` via tsconfig). No test framework — uses Node's built-in `assert`.
- Integration tests perform a 3-second connectivity pre-check; gracefully skip (exit 0) if Buda API is unreachable.
- `calculate_position_size` is fully client-side (no API call) — pure unit testing.
