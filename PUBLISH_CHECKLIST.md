# Publish Checklist — buda-mcp v1.4.0

Steps to publish `v1.4.0` to npm, the MCP registry, and notify community directories.

> **Important for v1.4.0:** The new `schedule_cancel_all` tool uses in-memory timer state that is lost on server restart. This is prominently documented in the tool description, README auth section, and CHANGELOG. Do NOT encourage users to rely on this tool in hosted/Railway deployments.

---

## 1. Pre-publish verification

```bash
# Confirm version
node -e "console.log(require('./package.json').version)"  # should print 1.4.0

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
git commit -m "chore: release v1.4.0

- simulate_order: live order cost simulation (no order placed, simulation: true)
- calculate_position_size: Kelly-style sizing from capital/risk/entry/stop (client-side)
- get_market_sentiment: composite score -100..+100 from price/volume/spread
- get_technical_indicators: RSI/MACD/BB/SMA20/SMA50 from trade history (no libs)
- schedule_cancel_all + renew_cancel_timer + disarm_cancel_timer: in-memory dead man's switch (auth-gated)
- aggregateTradesToCandles() extracted to utils.ts (shared by price_history + technical_indicators)
- OhlcvCandle interface moved to types.ts
- 59 unit tests (24 new)"

git tag v1.4.0
git push origin main --tags
```

Then create a GitHub Release from the tag:

---

**Release notes template (GitHub):**

```
## buda-mcp v1.4.0 — Trading Tools

### 5 new tools

**`simulate_order`** (public)
Simulates a buy or sell order using live ticker data — no order placed. Returns estimated fill price, fee (actual taker rate from market data: 0.8% crypto / 0.5% stablecoin), total cost, and slippage vs mid. All outputs include simulation: true.

**`calculate_position_size`** (public)
Kelly-style position sizing from capital, risk %, entry, and stop-loss. Fully client-side. Returns units, capital_at_risk, position_value, fee_impact, and a plain-text risk note.

**`get_market_sentiment`** (public)
Composite sentiment score (−100 to +100) from price variation 24h (40%), volume vs 7d average (35%), and spread vs market-type baseline (25%). Returns score, label, component breakdown, and disclaimer.

**`get_technical_indicators`** (public)
RSI (14), MACD (12/26/9), Bollinger Bands (20, 2σ), SMA 20, SMA 50 — computed server-side from Buda trade history with no external libraries. Returns signal interpretations and structured warning if insufficient candles.

**`schedule_cancel_all` + `renew_cancel_timer` + `disarm_cancel_timer`** (auth-gated)
In-memory dead man's switch: arms a timer that cancels all open orders if not renewed. WARNING: timer state is lost on server restart. Use only on locally-run instances.

### Infrastructure
- `aggregateTradesToCandles()` extracted to `utils.ts` — shared by `get_price_history` and `get_technical_indicators`
- `OhlcvCandle` interface exported from `types.ts`
- 59 unit tests (was 35)

```bash
npx @guiie/buda-mcp
```
```

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
Subject: [Update] buda-mcp v1.4.0 — simulate_order, technical indicators, sentiment, position sizing, dead man's switch

Hi mcp.so team,

I've released v1.4.0 of buda-mcp (@guiie/buda-mcp on npm).

Key changes (5 new tools + 3 sub-tools):
- simulate_order: live order cost simulation with actual fee rates (no order placed)
- calculate_position_size: Kelly-style position sizing (fully client-side)
- get_market_sentiment: composite score -100..+100 from price/volume/spread microstructure
- get_technical_indicators: RSI/MACD/Bollinger Bands/SMA (no external libs, from trade history)
- schedule_cancel_all / renew_cancel_timer / disarm_cancel_timer: in-memory dead man's switch (auth-gated)
- 59 unit tests (was 35)

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
Subject: [Update] buda-mcp v1.4.0

Hi Glama team,

buda-mcp has been updated to v1.4.0.

Package: @guiie/buda-mcp (npm)
Registry: io.github.gtorreal/buda-mcp (MCP Registry)
Version: 1.4.0

Changes (5 new tools + 3 sub-tools):
- simulate_order: order simulation with live data, simulation: true always set
- calculate_position_size: client-side position sizing
- get_market_sentiment: composite sentiment score with disclaimers
- get_technical_indicators: RSI/MACD/BB/SMA from trade history
- schedule_cancel_all + renew/disarm: in-memory dead man's switch (auth-gated, local use only)
- 59 unit tests

Quick start:
  npx @guiie/buda-mcp

Changelog: https://github.com/gtorreal/buda-mcp/blob/main/CHANGELOG.md
GitHub: https://github.com/gtorreal/buda-mcp

Thank you!
```

---

## 8. Post-publish verification

- [ ] `npx @guiie/buda-mcp@1.4.0` starts successfully
- [ ] `npm info @guiie/buda-mcp version` returns `1.4.0`
- [ ] GitHub release tag `v1.4.0` is visible
- [ ] MCP Registry entry reflects v1.4.0
- [ ] Smithery server card lists 14 public tools (including 4 new: simulate_order, calculate_position_size, get_market_sentiment, get_technical_indicators)
- [ ] Smithery server card lists 7 auth tools (including schedule_cancel_all, renew_cancel_timer, disarm_cancel_timer)
- [ ] `GET /health` returns `"version":"1.4.0"` on Railway deployment
- [ ] simulate_order response includes `simulation: true`
- [ ] get_technical_indicators returns `warning: "insufficient_data"` for markets with few trades
- [ ] schedule_cancel_all requires `confirmation_token="CONFIRM"` (test with wrong token)
- [ ] mcp.so listing updated
- [ ] Glama.ai listing updated

---

## ARCHIVED: v1.3.0 checklist

See git tag `v1.3.0` for the v1.3.0 release notes and verification steps.
