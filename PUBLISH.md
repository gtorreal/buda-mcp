# Publishing checklist

Everything that could be automated is already done.
This file contains only what requires your manual action, in order.

---

## What's already done

- [x] GitHub repo created and pushed → https://github.com/gtorreal/buda-mcp
- [x] `package.json` updated with `mcpName`, `repository`, `bin`, `keywords`
- [x] `server.json` generated for the official MCP registry
- [x] `marketplace/` assets generated for Cursor, Claude, ChatGPT, Gemini
- [x] GitHub Actions workflow created (`.github/workflows/publish.yml`)
  - Triggers automatically on every GitHub Release you create
  - Runs: build → test → npm publish → MCP registry publish
- [x] `mcp-publisher` CLI installed on your machine
- [x] `NPM_TOKEN` and `MCP_REGISTRY_TOKEN` secret slots created on GitHub
  - They contain placeholder values — you'll fill them in steps 1 and 3 below

---

## Step 1 — npm (one-time setup, ~5 min)

### 1a. Create an npm account if you don't have one
https://www.npmjs.com/signup

### 1b. Log in and publish

```bash
npm login
# Opens browser → log in → authorize

cd ~/Projects/buda-mcp
npm run build
npm publish --access public
```

### 1c. Put your npm token into GitHub Actions
1. Go to https://www.npmjs.com/settings/gtorreal/tokens
2. Create a new **Automation** token (type: "Granular Access Token" → select `@gtorreal/buda-mcp`)
3. Run:
```bash
gh secret set NPM_TOKEN --repo gtorreal/buda-mcp
# Paste the token when prompted
```

After this, every GitHub Release you create will auto-publish to npm.

---

## Step 2 — Official MCP Registry (~3 min)

`mcp-publisher` is already installed. Just run:

```bash
cd ~/Projects/buda-mcp

# Authenticate with GitHub (opens browser, one-time)
mcp-publisher login github

# Publish (uses the server.json already in the repo)
mcp-publisher publish
```

You'll see: `✓ Successfully published — io.github.gtorreal/buda-mcp version 1.0.0`

### 2b. Put your MCP Registry token into GitHub Actions (for auto-publish on release)

After `mcp-publisher login github`, your token is stored locally at `~/.config/mcp-publisher/`.

```bash
cat ~/.config/mcp-publisher/credentials.json
# Copy the token value, then:
gh secret set MCP_REGISTRY_TOKEN --repo gtorreal/buda-mcp
# Paste the token when prompted
```

---

## Step 3 — Community directories (web forms, ~10 min total)

These all auto-populate from the official MCP Registry within a week, but submitting
directly gets you listed faster.

### PulseMCP
URL: https://www.pulsemcp.com/submit
Fill in:
- Name: `buda-mcp`
- GitHub: `https://github.com/gtorreal/buda-mcp`
- npm: `@gtorreal/buda-mcp`
- Description: copy from `marketplace/claude-listing.md`

### Glama.ai
URL: https://glama.ai/mcp/servers → "Add Server" button
- GitHub URL: `https://github.com/gtorreal/buda-mcp`
- Glama scans it automatically

### mcp.so
URL: https://mcp.so — look for "Submit" or open a GitHub issue at their repo
- GitHub URL: `https://github.com/gtorreal/buda-mcp`

### mcpcentral.io
URL: https://mcpcentral.io/submit-server
- Fill in repo URL and npm package name

### awesome-mcp-servers (GitHub PR)
1. Fork https://github.com/punkpeye/awesome-mcp-servers
2. Add this line under the **Finance / Crypto** section:
   ```
   - [buda-mcp](https://github.com/gtorreal/buda-mcp) — Real-time market data from Buda.com (Chile/Colombia/Peru): prices, order books, trades, volume. No auth required.
   ```
3. Open a PR

---

## Step 4 — Smithery (~30 min, requires deployment)

Smithery requires an HTTP endpoint, not stdio. Steps:

### 4a. Create a Railway account
https://railway.app → sign in with GitHub

### 4b. Deploy
```bash
npm install -g @railway/cli
cd ~/Projects/buda-mcp
railway login
railway init   # select "Empty project"
railway up
```

You'll get a URL like `https://buda-mcp-production.up.railway.app`.

### 4c. Add HTTP transport to the server

You'll need to add a Streamable HTTP transport alongside the existing stdio one.
This requires a small code change — let me know and I'll implement it.

### 4d. Submit to Smithery
URL: https://smithery.ai/new
- Paste your Railway URL
- Smithery auto-scans and extracts the 5 tools

---

## Step 5 — ChatGPT GPT Action (~15 min, requires deployment from Step 4)

Once you have the Railway URL from Step 4:

1. Open `marketplace/openapi.yaml`
2. Replace `https://YOUR_DEPLOYED_DOMAIN` with your Railway URL
3. Go to https://chatgpt.com → Explore GPTs → Create → Configure → Add Action
4. Paste the contents of `marketplace/openapi.yaml`
5. Set Authentication to **None**
6. Save and publish the GPT

---

## Step 6 — Gemini / Google AI Studio

The `marketplace/gemini-tools.json` function declarations are ready to use now — no
deployment needed. To share them publicly:

1. In Google AI Studio (https://aistudio.google.com), create a new prompt
2. Click "Tools" → "Add function" → paste each declaration from `gemini-tools.json`
3. Save as a shared prompt and publish the link

For the Gemini Extensions marketplace (currently invite-only):
- Apply at https://ai.google.dev/gemini-api/docs/extensions
- Use `marketplace/gemini-tools.json` as your tool schema

---

## Step 7 — Create a GitHub Release (triggers auto-publish)

Once npm token and MCP registry token are set in GitHub Actions secrets (Steps 1c and 2b):

```bash
gh release create v1.0.0 \
  --title "v1.0.0 — Initial release" \
  --notes "5 public market data tools for Buda.com: get_markets, get_ticker, get_orderbook, get_trades, get_market_volume." \
  --latest
```

This triggers the Actions workflow: build → test → npm publish → MCP registry publish.
All future releases will auto-publish the same way.

---

## Summary

| Marketplace | Status | Time needed from you |
|---|---|---|
| GitHub | ✅ Done | — |
| npm | Needs your login | ~5 min |
| Official MCP Registry | Needs OAuth | ~3 min |
| PulseMCP | Web form | ~2 min |
| Glama.ai | Web form | ~1 min |
| mcp.so | Web form | ~2 min |
| mcpcentral.io | Web form | ~2 min |
| awesome-mcp-servers | GitHub PR | ~3 min |
| Smithery | Needs deployment | ~30 min |
| ChatGPT GPT Action | Needs deployment | ~15 min (after Smithery) |
| Gemini | Ready now | ~5 min |
| **GitHub Actions auto-publish** | Needs token secrets | ~5 min |
