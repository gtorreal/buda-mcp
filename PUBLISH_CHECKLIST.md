# Publish Checklist — buda-mcp v1.3.0

Steps to publish `v1.3.0` to npm, the MCP registry, and notify community directories.

---

## 1. Pre-publish verification

```bash
# Confirm version
node -e "console.log(require('./package.json').version)"  # should print 1.3.0

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
git commit -m "chore: release v1.3.0

- Flatten all response schemas: all monetary amounts now floats with _currency fields
- get_arbitrage_opportunities: cross-country price discrepancy detection (USDC-normalized)
- get_market_summary: one-call market overview with liquidity_rating
- buda://summary/{market} MCP Resource
- Rewritten tool descriptions with concrete examples and units
- 35 unit tests (12 new: flattenAmount, arbitrage discrepancy, liquidity_rating thresholds)
- src/utils.ts: shared flattenAmount() and getLiquidityRating() helpers"

git tag v1.3.0
git push origin main --tags
```

Then create a GitHub Release from the tag with the following release notes:

---

**Release notes template (GitHub):**

```
## buda-mcp v1.3.0 — Output Quality

### What's new

**Flat, typed response schemas (breaking change for field consumers)**
All tools now return floats instead of `["amount", "currency"]` arrays.
Every monetary Amount is split into a `value` (float) and `_currency` (string) field.
For example, `last_price: ["65000000", "CLP"]` → `last_price: 65000000, last_price_currency: "CLP"`.
Affected tools: get_ticker, get_market_volume, get_orderbook, get_trades, get_spread,
compare_markets, get_price_history, get_balances, get_orders.

**New tool: `get_market_summary`**
One-call summary: last price, bid/ask, spread %, 24h volume, price change 24h/7d, and
`liquidity_rating` ("high" < 0.3%, "medium" 0.3–1%, "low" > 1%). Best first tool to call.

**New tool: `get_arbitrage_opportunities`**
Detects cross-country price discrepancies for an asset across CLP/COP/PEN markets,
normalized to USDC. Includes pairwise discrepancy %, sorted by size.
Fees note: 0.8% taker fee per leg (~1.6% round-trip) included in every response.

**New MCP Resource: `buda://summary/{market}`**
Same data as get_market_summary, served as an MCP Resource in both stdio and HTTP transports.

**Improved tool descriptions**
All 12 tool descriptions rewritten: specific return types, units, and concrete example questions.

**Test suite: 35 unit tests (was 23)**
New sections: flattenAmount type correctness, arbitrage discrepancy calculation with mock data,
liquidity_rating boundary tests.

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
Subject: [Update] buda-mcp v1.3.0 — flat schemas, arbitrage tool, market summary tool

Hi mcp.so team,

I've released v1.3.0 of buda-mcp (@guiie/buda-mcp on npm).

Key changes:
- All tools now return flat typed objects: floats + _currency fields instead of [amount, currency] arrays
- New tool: get_market_summary — one-call overview with liquidity_rating (high/medium/low)
- New tool: get_arbitrage_opportunities — cross-country BTC/ETH/etc price discrepancy detection (USDC-normalized)
- New MCP Resource: buda://summary/{market}
- All tool descriptions rewritten with concrete example questions and units
- 35 unit tests (12 new)

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
Subject: [Update] buda-mcp v1.3.0

Hi Glama team,

buda-mcp has been updated to v1.3.0.

Package: @guiie/buda-mcp (npm)
Registry: io.github.gtorreal/buda-mcp (MCP Registry)
Version: 1.3.0

Changes:
- Flat response schemas: all monetary amounts now floats with _currency fields (LLM-friendly)
- New tool: get_market_summary (one-call overview, liquidity_rating)
- New tool: get_arbitrage_opportunities (cross-country USDC-normalized price discrepancy)
- New MCP Resource: buda://summary/{market}
- Rewritten descriptions with examples and units for all 12 tools
- 35 unit tests

Quick start:
  npx @guiie/buda-mcp

Changelog: https://github.com/gtorreal/buda-mcp/blob/main/CHANGELOG.md
GitHub: https://github.com/gtorreal/buda-mcp

Thank you!
```

---

## 8. Post-publish verification

- [ ] `npx @guiie/buda-mcp@1.3.0` starts successfully
- [ ] `npm info @guiie/buda-mcp version` returns `1.3.0`
- [ ] GitHub release tag `v1.3.0` is visible
- [ ] MCP Registry entry reflects v1.3.0
- [ ] Smithery server card lists 10 public tools (including get_market_summary, get_arbitrage_opportunities)
- [ ] `GET /health` returns `"version":"1.3.0"` on Railway deployment
- [ ] `GET /.well-known/mcp/server-card.json` returns 3 resources (including buda://summary/{market})
- [ ] get_ticker response has `last_price: <number>` not `last_price: ["...", "CLP"]`
- [ ] mcp.so listing updated
- [ ] Glama.ai listing updated
