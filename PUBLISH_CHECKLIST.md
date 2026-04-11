# Publish Checklist — buda-mcp v1.5.0

Steps to publish `v1.5.0` to npm, the MCP registry, and notify community directories.

---

## 1. Pre-publish verification

```bash
# Confirm version
node -e "console.log(require('./package.json').version)"  # should print 1.5.0

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

Tag and release already created via `gh release create v1.5.0`. Verify at:

https://github.com/gtorreal/buda-mcp/releases/tag/v1.5.0

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
Subject: [Update] buda-mcp v1.5.0 — Withdrawals, Deposits, Batch Orders & Lightning

Hi mcp.so team,

I've released v1.5.0 of buda-mcp (@guiie/buda-mcp on npm).

Key changes (8 new authenticated tools):
- cancel_all_orders: cancel all open orders (one market or all markets)
- cancel_order_by_client_id: cancel by client-assigned string ID
- place_batch_orders: place up to 20 orders with pre-validation (no rollback on partial failure)
- place_order extended: TIF flags (ioc/fok/post_only/gtd) + stop orders
- create_withdrawal: crypto (address) or fiat (bank_account_id) withdrawals
- create_fiat_deposit: record fiat deposits with duplicate guard
- lightning_withdrawal: pay a BOLT-11 invoice from LN-BTC reserve
- create_lightning_invoice: create a Lightning receive invoice
- 138 unit tests (was 106)

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
Subject: [Update] buda-mcp v1.5.0

Hi Glama team,

buda-mcp has been updated to v1.5.0.

Package: @guiie/buda-mcp (npm)
Registry: io.github.gtorreal/buda-mcp (MCP Registry)
Version: 1.5.0

Changes (8 new authenticated tools):
- cancel_all_orders / cancel_order_by_client_id: flexible order cancellation
- place_batch_orders: sequential multi-order placement with pre-validation
- place_order extended: IOC/FOK/post_only/GTD + stop orders
- create_withdrawal: crypto + fiat withdrawals
- create_fiat_deposit: fiat deposit recording
- lightning_withdrawal + create_lightning_invoice: Lightning Network support
- 138 unit tests

Quick start:
  npx @guiie/buda-mcp

Changelog: https://github.com/gtorreal/buda-mcp/blob/main/CHANGELOG.md
GitHub: https://github.com/gtorreal/buda-mcp

Thank you!
```

---

## 8. Post-publish verification

- [ ] `npx @guiie/buda-mcp@1.5.0` starts successfully
- [ ] `npm info @guiie/buda-mcp version` returns `1.5.0`
- [ ] GitHub release tag `v1.5.0` is visible ✅ (already created)
- [ ] MCP Registry entry reflects v1.5.0
- [ ] Smithery server card lists all new tools
- [ ] `GET /health` returns `"version":"1.5.0"` on Railway deployment
- [ ] `cancel_all_orders` requires `confirmation_token="CONFIRM"` (test with wrong token)
- [ ] `place_batch_orders` returns pre-validation error for invalid market (zero API calls)
- [ ] `lightning_withdrawal` shows invoice preview in CONFIRMATION_REQUIRED response
- [ ] `create_lightning_invoice` succeeds without confirmation token
- [ ] mcp.so listing updated
- [ ] Glama.ai listing updated

---

## ARCHIVED: v1.4.x checklists

See git tags `v1.4.0`, `v1.4.1`, `v1.4.2` for previous release notes and verification steps.
