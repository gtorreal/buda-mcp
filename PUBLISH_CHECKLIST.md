# Publish Checklist — buda-mcp v1.1.0

Steps to publish `v1.1.0` to npm, the MCP registry, and notify community directories.

---

## 1. Pre-publish verification

```bash
# Confirm version
node -e "console.log(require('./package.json').version)"  # should print 1.1.0

# Build and test
npm run build
npm test

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

Verify: https://www.npmjs.com/package/@gtorreal/buda-mcp

---

## 3. GitHub release

```bash
git add -A
git commit -m "chore: release v1.1.0

- 3 new public tools: get_spread, compare_markets, get_price_history
- HMAC-SHA384 auth scaffold (BUDA_API_KEY / BUDA_API_SECRET)
- 4 auth-gated tools: get_balances, get_orders, place_order, cancel_order
- TTL caching (markets 60s, tickers 5s, orderbooks 3s)
- MCP Resources: buda://markets, buda://ticker/{market}
- Structured error responses for all tools
- Updated README, marketplace files, CHANGELOG"

git tag v1.1.0
git push origin main --tags
```

Then create a GitHub Release from the tag with the following release notes:

---

**Release notes template (GitHub):**

```
## buda-mcp v1.1.0

### What's new

**3 new public tools**
- `get_spread` — bid/ask spread (absolute and %) for any market
- `compare_markets` — side-by-side ticker data for a base currency across all quote currencies
- `get_price_history` — OHLCV candles derived from recent trades (1h / 4h / 1d)

**HMAC auth scaffold**
- Set `BUDA_API_KEY` + `BUDA_API_SECRET` to unlock 4 authenticated tools
- `get_balances`, `get_orders`, `place_order`, `cancel_order`
- Public-only mode unchanged when no credentials are set

**Platform improvements**
- TTL caching: markets (60s), tickers (5s), order books (3s)
- MCP Resources: `buda://markets` and `buda://ticker/{market}`
- Structured `isError: true` responses for all tools
- Updated README with npx quickstart and per-tool examples

```bash
npx @gtorreal/buda-mcp
```
```

---

## 4. MCP Registry update

The GitHub Actions workflow (`.github/workflows/publish.yml`) runs automatically on GitHub release. It runs `mcp publish` via `mcp-publisher`. Verify the registry entry at:

https://registry.modelcontextprotocol.io/servers/io.github.gtorreal/buda-mcp

If the workflow doesn't trigger, run manually:

```bash
# Download mcp-publisher from GitHub releases (check for latest version)
curl -L https://github.com/modelcontextprotocol/mcp-publisher/releases/latest/download/mcp-publisher-macos -o mcp-publisher
chmod +x mcp-publisher
MCP_REGISTRY_TOKEN=<token> ./mcp-publisher publish
```

---

## 5. Smithery

Smithery auto-detects updates via the `/.well-known/mcp/server-card.json` endpoint on the Railway deployment. No manual action required after deploying.

Verify: https://smithery.ai/server/@gtorreal/buda-mcp

---

## 6. Notify mcp.so

**Method:** Submit via the mcp.so listing update form or open a PR to their repository.

**Email/message template:**

```
Subject: [Update] buda-mcp v1.1.0 — new tools + auth

Hi mcp.so team,

I've released v1.1.0 of buda-mcp (@gtorreal/buda-mcp on npm).

Key changes:
- 3 new public tools: get_spread, compare_markets, get_price_history (OHLCV)
- Optional HMAC auth scaffold (BUDA_API_KEY / BUDA_API_SECRET) unlocks 4 private tools: get_balances, get_orders, place_order, cancel_order
- TTL caching for all repeated data fetches
- MCP Resources: buda://markets and buda://ticker/{market}
- Structured error responses

Links:
- npm: https://www.npmjs.com/package/@gtorreal/buda-mcp
- GitHub: https://github.com/gtorreal/buda-mcp
- Changelog: https://github.com/gtorreal/buda-mcp/blob/main/CHANGELOG.md

Quick start: npx @gtorreal/buda-mcp

Thank you!
```

---

## 7. Notify Glama.ai

**Method:** Use Glama's submission form at https://glama.ai/mcp/servers or open an issue/PR on their directory repository.

**Message template:**

```
Subject: [Update] buda-mcp v1.1.0

Hi Glama team,

buda-mcp has been updated to v1.1.0. Here's a summary of what's new:

Package: @gtorreal/buda-mcp (npm)
Registry: io.github.gtorreal/buda-mcp (MCP Registry)
Version: 1.1.0

New tools added:
- get_spread: bid/ask spread for any market
- compare_markets: cross-currency price comparison for a base asset
- get_price_history: OHLCV candles from trade history (1h/4h/1d)
- get_balances, get_orders, place_order, cancel_order (authenticated, local-only)

New capabilities:
- MCP Resources protocol: buda://markets, buda://ticker/{market}
- TTL caching (60s/5s/3s by data type)
- Structured error responses (isError: true)

Quick start:
  npx @gtorreal/buda-mcp

Changelog: https://github.com/gtorreal/buda-mcp/blob/main/CHANGELOG.md
GitHub: https://github.com/gtorreal/buda-mcp

Thank you!
```

---

## 8. Post-publish verification

- [ ] `npx @gtorreal/buda-mcp@1.1.0` starts successfully
- [ ] `npm info @gtorreal/buda-mcp version` returns `1.1.0`
- [ ] GitHub release tag `v1.1.0` is visible
- [ ] MCP Registry entry reflects v1.1.0
- [ ] Smithery server card lists 8 public tools
- [ ] mcp.so listing updated
- [ ] Glama.ai listing updated
- [ ] Railway deployment health check returns `"version":"1.1.0"` at `/health`
