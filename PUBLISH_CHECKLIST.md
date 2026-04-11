# Publish Checklist — buda-mcp v2.0.0

Steps to publish `v2.0.0` to npm, the MCP registry, and notify community directories.

---

## 1. Pre-publish verification

```bash
# Confirm version
node -e "console.log(require('./package.json').version)"  # should print 2.0.0

# Build and test
npm run build
npm test

# Sync server.json version (already done, but confirm)
npm run sync-version
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

Create tag and release:

```bash
gh release create v2.0.0 --title "v2.0.0 — Public-only release" --notes "Removed all authenticated/private API tools. This version requires no API key and exposes only Buda.com public market data endpoints."
```

Verify at: https://github.com/gtorreal/buda-mcp/releases/tag/v2.0.0

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
Subject: [Update] buda-mcp v2.0.0 — Public-only release (no API key required)

Hi mcp.so team,

I've released v2.0.0 of buda-mcp (@guiie/buda-mcp on npm).

This is a major release that removes all authenticated/private API tools.
The server now works exclusively with Buda.com's public endpoints — no account
or API key required.

16 public tools included:
- get_market_summary, get_markets, get_ticker, get_orderbook, get_trades
- get_market_volume, get_spread, compare_markets, get_price_history
- get_arbitrage_opportunities, simulate_order, calculate_position_size
- get_market_sentiment, get_technical_indicators, get_real_quotation
- get_available_banks

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
Subject: [Update] buda-mcp v2.0.0

Hi Glama team,

buda-mcp has been updated to v2.0.0.

Package: @guiie/buda-mcp (npm)
Registry: io.github.gtorreal/buda-mcp (MCP Registry)
Version: 2.0.0

Changes (public-only release):
- Removed all 18 authenticated tool files (orders, balances, withdrawals, etc.)
- No API key or account required
- 16 public tools covering market data, analysis, and simulation
- 100 unit tests

Quick start:
  npx @guiie/buda-mcp

Changelog: https://github.com/gtorreal/buda-mcp/blob/main/CHANGELOG.md
GitHub: https://github.com/gtorreal/buda-mcp

Thank you!
```

---

## 8. Post-publish verification

- [ ] `npx @guiie/buda-mcp@2.0.0` starts successfully
- [ ] `npm info @guiie/buda-mcp version` returns `2.0.0`
- [ ] GitHub release tag `v2.0.0` is visible
- [ ] MCP Registry entry reflects v2.0.0
- [ ] Smithery server card lists all 16 tools (no auth tools)
- [ ] `GET /health` responds on Railway deployment
- [ ] `GET /.well-known/mcp/server-card.json` shows `authentication.required: false`
- [ ] mcp.so listing updated
- [ ] Glama.ai listing updated

---

## ARCHIVED: previous checklists

See git tags `v1.5.6`, `v1.5.0`, `v1.4.0`, `v1.4.1` for previous release notes and verification steps.
The full version with authenticated tools is preserved in the `with-auth` branch.
