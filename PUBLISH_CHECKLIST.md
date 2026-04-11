# Publish Checklist — buda-mcp v1.5.3

Steps to publish `v1.5.3` to npm, the MCP registry, and notify community directories.

---

## 1. Pre-publish verification

```bash
# Confirm version
node -e "console.log(require('./package.json').version)"  # should print 1.5.3

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

Tag and release already created via `gh release create v1.5.3`. Verify at:

https://github.com/gtorreal/buda-mcp/releases/tag/v1.5.3

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
Subject: [Update] buda-mcp v1.5.3 — Security hardening (third pass)

Hi mcp.so team,

I've released v1.5.3 of buda-mcp (@guiie/buda-mcp on npm).

Key changes (security hardening, no new tools):
- Upstream API errors no longer forwarded to MCP clients (generic messages only, detail logged server-side)
- Audit log transport field corrected for HTTP (9 handlers previously showed "stdio" for HTTP traffic)
- HTTP security headers via helmet (X-Content-Type-Options, X-Frame-Options, Referrer-Policy, etc.)
- Request body size limit enforced (10kb) on /mcp endpoint
- Rate limiting extended to /health and /.well-known/mcp/server-card.json endpoints

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
Subject: [Update] buda-mcp v1.5.3

Hi Glama team,

buda-mcp has been updated to v1.5.3.

Package: @guiie/buda-mcp (npm)
Registry: io.github.gtorreal/buda-mcp (MCP Registry)
Version: 1.5.3

Changes (security hardening, third pass):
- Upstream API errors no longer forwarded to MCP clients
- Audit log transport field corrected for HTTP (9 handlers)
- HTTP security headers via helmet
- Request body size limit (10kb) on /mcp endpoint
- Rate limiting on /health and server-card endpoints
- 184 unit tests

Quick start:
  npx @guiie/buda-mcp

Changelog: https://github.com/gtorreal/buda-mcp/blob/main/CHANGELOG.md
GitHub: https://github.com/gtorreal/buda-mcp

Thank you!
```

---

## 8. Post-publish verification

- [ ] `npx @guiie/buda-mcp@1.5.3` starts successfully
- [ ] `npm info @guiie/buda-mcp version` returns `1.5.3`
- [ ] GitHub release tag `v1.5.3` is visible
- [ ] MCP Registry entry reflects v1.5.3
- [ ] Smithery server card lists all tools
- [ ] `GET /health` returns `"version":"1.5.3"` on Railway deployment
- [ ] `GET /health` responds with `X-Content-Type-Options: nosniff` header (helmet active)
- [ ] `GET /health` rate-limited at 60 req/min
- [ ] Error responses from the MCP server show generic message (not raw Buda API detail)
- [ ] Audit log shows `"transport":"http"` for HTTP-triggered destructive tools
- [ ] Pending: manually apply CI binary pinning to `publish.yml` (see CHANGELOG v1.5.3)
- [ ] mcp.so listing updated
- [ ] Glama.ai listing updated

---

---

## 9. Pending manual fix — CI binary pinning

Edit `.github/workflows/publish.yml`, replace the `Install mcp-publisher` step with:

```yaml
- name: Install mcp-publisher
  env:
    MCP_PUBLISHER_VERSION: "v1.5.0"
    MCP_PUBLISHER_SHA256: "79bbb73ba048c5906034f73ef6286d7763bd53cf368ea0b358fc593ed360cbd5"
  run: |
    curl -fsSL "https://github.com/modelcontextprotocol/registry/releases/download/${MCP_PUBLISHER_VERSION}/mcp-publisher_linux_amd64.tar.gz" \
      -o mcp-publisher.tar.gz
    echo "${MCP_PUBLISHER_SHA256}  mcp-publisher.tar.gz" | sha256sum --check
    tar xz -f mcp-publisher.tar.gz mcp-publisher
    sudo mv mcp-publisher /usr/local/bin/
```

SHA256 verified against GitHub release `v1.5.0` on 2026-04-11. Update both values when bumping `mcp-publisher`.

---

## ARCHIVED: previous checklists

See git tags `v1.5.0`, `v1.5.1`, `v1.4.0`, `v1.4.1`, `v1.4.2` for previous release notes and verification steps.
