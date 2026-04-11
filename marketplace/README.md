# Marketplace Submission Assets — v2.0.0

Ready-to-use assets for submitting buda-mcp to every major AI marketplace.
Replace `gtorreal` / `gtorreal` with your actual handles before submitting.

---

## `cursor-mcp.json` — Cursor

Add to `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (per project).
Uses `npx` so users don't need to clone the repo.

**PR submission:** Open a PR against the [Cursor MCP directory](https://github.com/getcursor/cursor) following their contribution guide. Include this file and a link to the npm package.

---

## `claude-listing.md` — Claude / Anthropic MCP Registry

Paste this content into the Anthropic MCP server submission form, or use it as the
body of a GitHub issue on the [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers) repo.

For the official registry (`registry.modelcontextprotocol.io`), the listing is generated
automatically from `server.json` via `mcp-publisher` — see the main README for those steps.

---

## `openapi.yaml` — ChatGPT GPT Actions

Used to register buda-mcp as a ChatGPT Action inside a custom GPT.

**Steps:**
1. Deploy the server over HTTP:
   ```bash
   pip install mcp-proxy
   mcp-proxy --port 8000 -- npx -y @guiie/buda-mcp
   ```
2. Replace `https://YOUR_DEPLOYED_DOMAIN` in `openapi.yaml` with your public URL.
3. In the GPT editor → "Actions" → "Add action" → paste the YAML.
4. Set authentication to "None".

For production, deploy to Railway, Fly.io, or Render so the URL is stable.

---

## `gemini-tools.json` — Gemini API / Google AI Studio

Paste the `functionDeclarations` array into your Gemini API call:

```python
import google.generativeai as genai
import json

with open("gemini-tools.json") as f:
    tool_config = json.load(f)

model = genai.GenerativeModel(
    model_name="gemini-2.0-flash",
    tools=[{"function_declarations": tool_config["functionDeclarations"]}],
)
```

For **Google AI Studio**, go to *System instructions → Tools → Add function* and paste
each `functionDeclaration` object individually.

For the **Gemini marketplace / Extensions** (once generally available), submit via the
[Google AI Extensions portal](https://ai.google.dev/) using these declarations as the
tool schema.
