# AGENTS.md — buda-mcp

MCP server exposing [Buda.com](https://www.buda.com/) public REST API v2 as tools and resources for AI assistants. No API key required (v2.0.0+).

## Layout

```
src/index.ts          stdio MCP server entrypoint
src/http.ts           HTTP/SSE MCP server entrypoint (Express, stateless)
src/client.ts         BudaClient — fetch wrapper, 429 retry, error sanitization
src/cache.ts          In-memory TTL cache with in-flight deduplication
src/validation.ts     validateMarketId(), validateCurrency()
src/utils.ts          flattenAmount(), aggregateTradesToCandles(), etc.
src/format.ts         Shared markdown formatting helpers (liquidityBadge, fmtSlippage, fmtTimestamp)
src/version.ts        Version string (reads package.json)
src/types.ts          TypeScript types for Buda API responses
src/tools/            One file per tool — each exports register(), toolSchema, handler
test/unit.ts          Unit tests (no network)
test/run-all.ts       Integration tests (live API, skips if unreachable)
marketplace/          Listing artifacts (openapi.yaml, gemini-tools.json, claude-listing.md)
scripts/              sync-version.mjs
```

## Commands

- Install: `npm install`
- Dev (stdio): `npm run dev`
- Dev (HTTP): `npm run dev:http`
- Build: `npm run build`
- Test (all): `npm test`
- Test (unit only): `npm run test:unit`
- Test (integration): `npm run test:integration`
- Sync version: `npm run sync-version`
- Publish: `npm publish --access public --provenance`

## Invariants

NEVER violate without an ADR amendment.

- **Public-only API.** No authenticated/private tools exist since v2.0.0. NEVER accept or require API keys. The `with-auth` branch preserves legacy auth code.
- **Tool output is markdown.** Every tool MUST return pre-formatted markdown via `content: [{ type: "text", text }]`. Use `src/format.ts` helpers. NEVER return raw `JSON.stringify`.
- **Agent passthrough.** Downstream agents MUST relay tool output verbatim — no re-summary, re-table, or paraphrase unless the user asks.
- **Input validation before URL interpolation.** MUST call `validateMarketId()` or `validateCurrency()` before building API paths. Validation errors MUST use static strings — NEVER embed user input.
- **Error sanitization.** Internal details (paths, stack traces) go to `stderr` only. Callers see generic messages via `formatApiError()`.
- **Dual entrypoint registration.** New tools MUST be registered in both `src/index.ts` (stdio) and `src/http.ts` (HTTP).
- **Version in package.json only.** Run `npm run sync-version` after bumping. NEVER hardcode version strings.

## Conventions

- TypeScript strict mode, ESM (`"type": "module"`), target ES2022, Node >= 18.
- Each tool file exports `toolSchema`, `register()`, and an exported handler for unit testing.
- Cache TTLs: markets/banks 60s, ticker 5s, orderbook 3s. HTTP transport creates a fresh `MemoryCache` per request.
- Single 429 retry with `Retry-After` header (capped at 30s). 15s fetch timeout on all API calls.
- Marketplace files (`marketplace/`) MUST be updated when tools change.

## Decisions

No ADR directory yet. Load-bearing decisions are tracked inline:
- 2026-04-11: Removed all auth tools → public-only v2.0.0 (see CHANGELOG.md)
- 2026-04-11: Adopted markdown tool output format (see `.cursor/rules/tool-output-format.mdc`)

## Maintenance

- Load-bearing decision → new ADR in `docs/adr/` + invariant line here
- Operational knowledge → `docs/PROJECT_MEMORY.md`
- Scoped coding convention → `.cursor/rules/*.mdc`
- General convention → Conventions section above
- Hygiene: split this file if > 80 lines; promote stable PROJECT_MEMORY sections to ADRs; split rule files if > 60 lines
- Pruning: remove superseded entries, don't just append
