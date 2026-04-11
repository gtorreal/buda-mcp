# Publish Checklist — buda-mcp v1.5.1

Steps to publish `v1.5.1` to npm, the MCP registry, and notify community directories.

---

## 1. Pre-publish verification

```bash
# Confirm version
node -e "console.log(require('./package.json').version)"  # should print 1.5.1

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

Tag and release already created via `gh release create v1.5.1`. Verify at:

https://github.com/gtorreal/buda-mcp/releases/tag/v1.5.1

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
Subject: [Update] buda-mcp v1.5.1 — Security hardening release

Hi mcp.so team,

I've released v1.5.1 of buda-mcp (@guiie/buda-mcp on npm).

Key changes (security hardening, no new tools):
- HTTP startup guard: server exits if credentials are set without MCP_AUTH_TOKEN
- Rate limiting: 120 req/min per IP on /mcp (configurable via MCP_RATE_LIMIT)
- Crypto address validation in create_withdrawal (BTC, ETH, USDC, USDT, LTC, BCH, XRP)
- BOLT-11 invoice format validation in lightning_withdrawal
- Dead man's switch blocked on HTTP transport (process restarts drop timers)
- place_batch_orders: optional max_notional spending cap
- 156 unit tests (was 136)

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
Subject: [Update] buda-mcp v1.5.1

Hi Glama team,

buda-mcp has been updated to v1.5.1.

Package: @guiie/buda-mcp (npm)
Registry: io.github.gtorreal/buda-mcp (MCP Registry)
Version: 1.5.1

Changes (security hardening):
- HTTP startup guard for missing MCP_AUTH_TOKEN
- Rate limiting on /mcp (120 req/min per IP)
- Crypto address format validation in create_withdrawal
- BOLT-11 invoice validation in lightning_withdrawal
- Dead man's switch blocked on HTTP transport
- place_batch_orders: optional max_notional cap
- 156 unit tests

Quick start:
  npx @guiie/buda-mcp

Changelog: https://github.com/gtorreal/buda-mcp/blob/main/CHANGELOG.md
GitHub: https://github.com/gtorreal/buda-mcp

Thank you!
```

---

## 8. Post-publish verification

- [ ] `npx @guiie/buda-mcp@1.5.1` starts successfully
- [ ] `npm info @guiie/buda-mcp version` returns `1.5.1`
- [ ] GitHub release tag `v1.5.1` is visible
- [ ] MCP Registry entry reflects v1.5.1
- [ ] Smithery server card lists all tools
- [ ] `GET /health` returns `"version":"1.5.1"` on Railway deployment
- [ ] HTTP server exits if `BUDA_API_KEY` set but `MCP_AUTH_TOKEN` is absent
- [ ] `create_withdrawal` rejects a truncated BTC address with `INVALID_ADDRESS`
- [ ] `lightning_withdrawal` rejects a non-BOLT11 string with `INVALID_INVOICE`
- [ ] `place_batch_orders` with `max_notional` rejects over-cap batch before API call
- [ ] `schedule_cancel_all` via HTTP returns `TRANSPORT_NOT_SUPPORTED`
- [ ] mcp.so listing updated
- [ ] Glama.ai listing updated

---

## ARCHIVED: previous checklists

See git tags `v1.5.0`, `v1.4.0`, `v1.4.1`, `v1.4.2` for previous release notes and verification steps.
