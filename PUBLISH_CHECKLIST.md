# Publish Checklist — buda-mcp v1.5.2

Steps to publish `v1.5.2` to npm, the MCP registry, and notify community directories.

---

## 1. Pre-publish verification

```bash
# Confirm version
node -e "console.log(require('./package.json').version)"  # should print 1.5.2

# Build and test
npm run build
npm test

# Sync server.json version (already done, but confirm)
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

Tag and release already created via `gh release create v1.5.2`. Verify at:

https://github.com/gtorreal/buda-mcp/releases/tag/v1.5.2

---

## 4. MCP Registry update

The GitHub Actions workflow (`.github/workflows/publish.yml`) runs automatically on GitHub release. Verify at:

https://registry.modelcontextprotocol.io/servers/io.github.gtorreal/buda-mcp

---

## 5. Smithery

Smithery auto-detects updates via the `/.well-known/mcp/server-card.json` endpoint on the Railway deployment. No manual action required after deploying.

Verify: https://smithery.ai/server/@guiie/buda-mcp

---

## 6. Notify mcp.so

**Email/message template:**

```
Subject: [Update] buda-mcp v1.5.2 — Security hardening (second pass)

Hi mcp.so team,

I've released v1.5.2 of buda-mcp (@guiie/buda-mcp on npm).

Key changes (security hardening, no new tools):
- Constant-time token comparison (timing-safe Bearer token auth)
- Strict environment variable validation (PORT, MCP_RATE_LIMIT) with safe exit on bad config
- MCP_AUTH_TOKEN entropy warning (< 32 chars)
- trust proxy support for correct client IP detection behind reverse proxies
- Audit logging for all 11 destructive tool handlers (structured JSON to stderr)
- Dead man's switch: renew/disarm also blocked on HTTP transport
- validateCurrency() added to compare_markets tool
- Stronger BOLT-11 regex validation in lightning_withdrawal
- Internal API paths redacted from all error responses (31 tool handlers)
- 28 new unit tests (total now 184)

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
Subject: [Update] buda-mcp v1.5.2

Hi Glama team,

buda-mcp has been updated to v1.5.2.

Package: @guiie/buda-mcp (npm)
Registry: io.github.gtorreal/buda-mcp (MCP Registry)
Version: 1.5.2

Changes (security hardening, second pass):
- Constant-time token comparison (timing-safe auth)
- Strict env var validation (PORT, MCP_RATE_LIMIT)
- Audit logging for all destructive handlers
- Dead man's switch: renew/disarm also blocked on HTTP
- validateCurrency() in compare_markets
- Stronger BOLT-11 regex
- Internal paths redacted from error responses
- 184 unit tests

Quick start:
  npx @guiie/buda-mcp

Changelog: https://github.com/gtorreal/buda-mcp/blob/main/CHANGELOG.md
GitHub: https://github.com/gtorreal/buda-mcp

Thank you!
```

---

## 8. Post-publish verification

- [ ] `npx @guiie/buda-mcp@1.5.2` starts successfully
- [ ] `npm info @guiie/buda-mcp version` returns `1.5.2`
- [ ] GitHub release tag `v1.5.2` is visible
- [ ] MCP Registry entry reflects v1.5.2
- [ ] Smithery server card lists all tools
- [ ] `GET /health` returns `"version":"1.5.2"` on Railway deployment
- [ ] HTTP server exits if `BUDA_API_KEY` set but `MCP_AUTH_TOKEN` is absent
- [ ] `create_withdrawal` rejects a truncated BTC address with `INVALID_ADDRESS`
- [ ] `lightning_withdrawal` rejects a non-BOLT11 string with `INVALID_INVOICE`
- [ ] `place_batch_orders` with `max_notional` rejects over-cap batch before API call
- [ ] `schedule_cancel_all` via HTTP returns `TRANSPORT_NOT_SUPPORTED`
- [ ] `renew_cancel_timer` via HTTP returns `TRANSPORT_NOT_SUPPORTED`
- [ ] Error responses do NOT include internal `path` field
- [ ] Audit events appear in stderr as JSON with `audit: true`
- [ ] mcp.so listing updated
- [ ] Glama.ai listing updated

---

## ARCHIVED: previous checklists

See git tags `v1.5.0`, `v1.5.1`, `v1.4.0`, `v1.4.1`, `v1.4.2` for previous release notes and verification steps.
