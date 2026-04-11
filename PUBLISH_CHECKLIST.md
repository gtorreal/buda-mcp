# Publish Checklist — buda-mcp v1.2.0

Steps to publish `v1.2.0` to npm, the MCP registry, and notify community directories.

---

## 1. Pre-publish verification

```bash
# Confirm version
node -e "console.log(require('./package.json').version)"  # should print 1.2.0

# Build and test
npm run build
npm test

# Sync server.json version (already done, but run again to confirm)
npm run sync-version

# Verify no credentials are logged (audit)
grep -r "apiKey\|apiSecret\|BUDA_API" dist/ --include="*.js" | grep -v "process.env\|hasAuth\|X-SBTC-APIKEY\|authHeaders\|constructor"
# Should return empty or only header name strings — never credential values
```

---

## 2. npm publish

```bash
npm login   # if not already logged in
npm publish --access public --provenance
```

Verify: https://www.npmjs.com/package/@guiie/buda-mcp

---

## 3. GitHub release

```bash
git add -A
git commit -m "chore: release v1.2.0

- Single version source-of-truth via src/version.ts (no more hardcoded strings)
- Programmatic server-card in http.ts (toolSchema exported per tool)
- .env.example with documented BUDA_API_KEY / BUDA_API_SECRET
- Input sanitization: validateMarketId regex on all market_id inputs
- 429 retry with Retry-After (seconds, per RFC 7231), default 1s
- get_price_history: limit raised to 1000, UTC bucketing documented
- 23 unit tests: HMAC signing, cache dedup, confirmation guard, sanitization, 429 retry
- Integration tests: graceful skip when Buda API is unreachable"

git tag v1.2.0
git push origin main --tags
```

Then create a GitHub Release from the tag with the following release notes:

---

**Release notes template (GitHub):**

```
## buda-mcp v1.2.0

### What's new

**Bug fixes & maintenance**
- Single version source-of-truth: all version strings now read from `package.json` at startup via `src/version.ts` — no more drift between files
- `http.ts` server-card assembled programmatically from exported `toolSchema` constants — adding a tool no longer requires touching `http.ts`

**Security / reliability**
- Input sanitization: all `market_id` inputs validated against `/^[A-Z0-9]{2,10}-[A-Z0-9]{2,10}$/i` before URL interpolation — rejects path traversal and malformed IDs with structured errors
- 429 retry: `BudaClient` retries once on rate-limit responses, honoring the `Retry-After` header (seconds, per RFC 7231; defaults to 1s if absent). Double-429 throws `BudaApiError` with `retryAfterMs`.

**DX improvements**
- `.env.example` added for easy credential setup
- `get_price_history` limit raised from 100 to 1000 trades; UTC bucketing documented prominently
- `npm run sync-version` syncs `server.json` from `package.json` automatically

**Test suite**
- 23 new unit tests (no live API needed): HMAC signing exactness, cache deduplication, confirmation_token guards, input sanitization, 429 retry behavior
- Integration tests skip gracefully when Buda API is unreachable (CI-friendly)
- New scripts: `npm run test:unit`, `npm run test:integration`

```bash
npx @guiie/buda-mcp
```
```

---

## 4. MCP Registry update

The GitHub Actions workflow (`.github/workflows/publish.yml`) runs automatically on GitHub release. Verify at:

https://registry.modelcontextprotocol.io/servers/io.github.gtorreal/buda-mcp

If the workflow doesn't trigger, run manually:

```bash
MCP_REGISTRY_TOKEN=<token> ./mcp-publisher publish
```

---

## 5. Smithery

Smithery auto-detects updates via the `/.well-known/mcp/server-card.json` endpoint on the Railway deployment. No manual action required after deploying.

Verify: https://smithery.ai/server/@guiie/buda-mcp

---

## 6. Notify mcp.so

**Email/message template:**

```
Subject: [Update] buda-mcp v1.2.0 — input sanitization, 429 retry, 23 unit tests

Hi mcp.so team,

I've released v1.2.0 of buda-mcp (@guiie/buda-mcp on npm).

Key changes:
- Input sanitization: all market IDs validated against a strict regex before URL use
- 429 rate-limit retry: honors Retry-After header (seconds, RFC 7231), defaults to 1s
- get_price_history: limit raised to 1000 trades for deeper history
- 23 unit tests added (no live API required): HMAC, cache dedup, confirmation guards, sanitization, retry
- Single version source-of-truth (package.json → all files via src/version.ts)
- .env.example added for easy credential setup

Links:
- npm: https://www.npmjs.com/package/@guiie/buda-mcp
- GitHub: https://github.com/gtorreal/buda-mcp
- Changelog: https://github.com/gtorreal/buda-mcp/blob/main/CHANGELOG.md

Quick start: npx @guiie/buda-mcp

Thank you!
```

---

## 7. Notify Glama.ai

**Message template:**

```
Subject: [Update] buda-mcp v1.2.0

Hi Glama team,

buda-mcp has been updated to v1.2.0.

Package: @guiie/buda-mcp (npm)
Registry: io.github.gtorreal/buda-mcp (MCP Registry)
Version: 1.2.0

Changes:
- Input validation on all market_id inputs (structured isError: true on failure)
- 429 retry with Retry-After support (RFC 7231 seconds; default 1s)
- get_price_history limit raised to 1000 trades; UTC bucket timestamps documented
- 23 unit tests: HMAC signing, cache deduplication, confirmation guards, sanitization, retry
- Single version source (package.json); .env.example added

Quick start:
  npx @guiie/buda-mcp

Changelog: https://github.com/gtorreal/buda-mcp/blob/main/CHANGELOG.md
GitHub: https://github.com/gtorreal/buda-mcp

Thank you!
```

---

## 8. Post-publish verification

- [ ] `npx @guiie/buda-mcp@1.2.0` starts successfully
- [ ] `npm info @guiie/buda-mcp version` returns `1.2.0`
- [ ] GitHub release tag `v1.2.0` is visible
- [ ] MCP Registry entry reflects v1.2.0
- [ ] Smithery server card lists 8 public tools (with updated get_price_history description)
- [ ] `GET /health` returns `"version":"1.2.0"` on Railway deployment
- [ ] `GET /.well-known/mcp/server-card.json` returns tools with updated schemas (no hardcoded JSON)
- [ ] mcp.so listing updated
- [ ] Glama.ai listing updated
