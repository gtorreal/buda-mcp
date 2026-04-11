# buda-mcp

[![npm version](https://img.shields.io/npm/v/@guiie/buda-mcp)](https://www.npmjs.com/package/@guiie/buda-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js >=18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)

MCP server for [Buda.com](https://www.buda.com/) — the leading cryptocurrency exchange in Chile, Colombia, and Peru. Gives any MCP-compatible AI assistant live access to market data, order books, trade history, spreads, and (when credentials are provided) private account tools.

---

## Quick Start

```bash
npx @guiie/buda-mcp
```

Or install permanently:

```bash
npm install -g @guiie/buda-mcp
buda-mcp
```

---

## Install in your MCP client

### Claude Code

```bash
claude mcp add buda-mcp -- npx -y @guiie/buda-mcp
```

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "buda-mcp": {
      "command": "npx",
      "args": ["-y", "@guiie/buda-mcp"]
    }
  }
}
```

### Cursor (`~/.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "buda-mcp": {
      "command": "npx",
      "args": ["-y", "@guiie/buda-mcp"]
    }
  }
}
```

---

## Tools

### Public tools (no credentials required)

#### `get_markets`
List all 26 trading pairs on Buda.com, or get details for a specific market.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `market_id` | string | No | Market ID (e.g. `BTC-CLP`). Omit to list all markets. |

**Example prompts:**
- *"List all markets available on Buda.com"*
- *"What are the trading fees for BTC-CLP?"*
- *"What's the minimum order size for ETH-COP?"*

---

#### `get_ticker`
Current snapshot: last price, best bid/ask, 24h volume, and price change over 24h and 7d.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `market_id` | string | Yes | Market ID (e.g. `BTC-CLP`, `ETH-COP`). |

**Example prompts:**
- *"What is the current Bitcoin price in Chilean pesos?"*
- *"Show me the ETH-COP ticker"*
- *"How much has BTC changed in the last 7 days on Buda?"*

---

#### `get_orderbook`
Current order book: sorted bids and asks as `[price, amount]` pairs.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `market_id` | string | Yes | Market ID. |
| `limit` | number | No | Max price levels per side (default: all). |

**Example prompts:**
- *"Show me the BTC-CLP order book — top 10 bids and asks"*
- *"How deep is the ETH-BTC order book?"*

---

#### `get_trades`
Recent trade history. Each entry: `[timestamp_ms, amount, price, direction]`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `market_id` | string | Yes | Market ID. |
| `limit` | number | No | Number of trades (default 50, max 100). |
| `timestamp` | number | No | Unix seconds — returns trades older than this (pagination). |

**Example prompts:**
- *"Show the last 20 trades on BTC-CLP"*
- *"Were there more buys or sells in the last 50 BTC-COP trades?"*

---

#### `get_market_volume`
24h and 7-day transacted volume by side (bid = buys, ask = sells).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `market_id` | string | Yes | Market ID. |

**Example prompts:**
- *"How much ETH was traded on Buda in the last 7 days?"*
- *"What's the BTC-CLP buy vs sell volume over 24 hours?"*

---

#### `get_spread`
Bid/ask spread: absolute value and percentage of the ask price.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `market_id` | string | Yes | Market ID. |

**Example prompts:**
- *"What's the spread on BTC-COP right now?"*
- *"Is the ETH-CLP spread tighter than BTC-CLP?"*

---

#### `compare_markets`
Side-by-side ticker data for all pairs of a given base currency (CLP, COP, PEN, USDC…).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `base_currency` | string | Yes | Base currency to compare (e.g. `BTC`, `ETH`). |

**Example prompts:**
- *"Compare the Bitcoin price across all Buda markets"*
- *"Show me ETH in CLP, COP, and PEN side by side"*
- *"Which Buda market has the highest BTC trading volume?"*

---

#### `get_price_history`
OHLCV candles derived from recent trade history (Buda has no native candlestick endpoint — candles are aggregated client-side from raw trades). Candle timestamps are UTC bucket boundaries. Increasing `limit` gives deeper history at the cost of a slower response.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `market_id` | string | Yes | Market ID. |
| `period` | `1h` \| `4h` \| `1d` | No | Candle period (default `1h`). |
| `limit` | number | No | Raw trades to fetch before aggregation (default 100, max 1000). |

**Example prompts:**
- *"Show me hourly price candles for BTC-CLP"*
- *"What were the daily open/high/low/close for ETH-COP?"*

---

### Authenticated tools

Available only when `BUDA_API_KEY` and `BUDA_API_SECRET` environment variables are set. See [Authentication mode](#authentication-mode) below.

> **Warning:** Authenticated instances must be run **locally only**. Never expose a server with API credentials to the internet.

#### `get_balances`
All currency balances: total, available, frozen, and pending withdrawal.

**Example prompts:**
- *"What's my BTC balance on Buda?"*
- *"Show all my balances"*

---

#### `get_orders`
Orders for a given market, filterable by state.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `market_id` | string | Yes | Market ID. |
| `state` | string | No | `pending`, `active`, `traded`, `canceled`, `canceled_and_traded`. |
| `per` | number | No | Results per page (default 20, max 300). |
| `page` | number | No | Page number (default 1). |

**Example prompts:**
- *"Show my open orders on BTC-CLP"*
- *"List my last 10 traded orders on ETH-COP"*

---

#### `place_order`
Place a limit or market order.

**Requires `confirmation_token="CONFIRM"`** — prevents accidental execution from ambiguous prompts.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `market_id` | string | Yes | Market ID. |
| `type` | `Bid` \| `Ask` | Yes | Order side. |
| `price_type` | `limit` \| `market` | Yes | Order type. |
| `amount` | number | Yes | Order size in base currency. |
| `limit_price` | number | No | Required for limit orders. |
| `confirmation_token` | string | Yes | Must equal `"CONFIRM"` to execute. |

**Example prompts:**
- *"Place a limit buy order for 0.001 BTC at 60,000,000 CLP on BTC-CLP, confirmation_token=CONFIRM"*

---

#### `cancel_order`
Cancel an open order by ID.

**Requires `confirmation_token="CONFIRM"`**.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `order_id` | number | Yes | Numeric order ID. |
| `confirmation_token` | string | Yes | Must equal `"CONFIRM"` to cancel. |

---

## MCP Resources

In addition to tools, the server exposes two MCP Resources that clients can read directly:

| URI | Description |
|-----|-------------|
| `buda://markets` | JSON list of all Buda.com markets |
| `buda://ticker/{market}` | JSON ticker for a specific market (e.g. `buda://ticker/BTC-CLP`) |

---

## Authentication mode

The server defaults to **public-only mode** — no API key needed, no breaking changes for existing users.

To enable authenticated tools, copy `.env.example` to `.env` and fill in your credentials, then set them as environment variables before running:

```bash
BUDA_API_KEY=your_api_key BUDA_API_SECRET=your_api_secret npx @guiie/buda-mcp
```

Or in Claude Desktop config:

```json
{
  "mcpServers": {
    "buda-mcp": {
      "command": "npx",
      "args": ["-y", "@guiie/buda-mcp"],
      "env": {
        "BUDA_API_KEY": "your_api_key",
        "BUDA_API_SECRET": "your_api_secret"
      }
    }
  }
}
```

Authentication uses HMAC-SHA384 signing per the [Buda API docs](https://api.buda.com/en/#authentication). Keys are never logged.

> **Security:** Never expose an authenticated instance on a public server. Always run locally when using API credentials.

---

## Markets covered

| Quote | Country | Sample pairs |
|-------|---------|-------------|
| CLP | Chile | BTC-CLP, ETH-CLP, SOL-CLP |
| COP | Colombia | BTC-COP, ETH-COP, SOL-COP |
| PEN | Peru | BTC-PEN, ETH-PEN |
| USDC | USD-pegged | BTC-USDC, USDT-USDC |
| BTC | Cross | ETH-BTC, LTC-BTC, BCH-BTC |

---

## Build from source

```bash
git clone https://github.com/gtorreal/buda-mcp.git
cd buda-mcp
npm install
npm run build
node dist/index.js        # stdio (for MCP clients)
node dist/http.js         # HTTP on port 3000 (for Railway / hosted)
```

Run tests (requires live internet access):

```bash
npm test
```

---

## HTTP / Railway deployment

The `dist/http.js` entrypoint runs an Express server with:
- `POST /mcp` — Streamable HTTP MCP transport
- `GET /mcp` — SSE streaming transport
- `GET /health` — health check (`{ status, version, auth_mode }`)
- `GET /.well-known/mcp/server-card.json` — Smithery-compatible static tool manifest

Set `PORT` environment variable to override the default `3000`.

---

## Project structure

```
src/
  client.ts          BudaClient (HTTP + HMAC auth)
  cache.ts           In-memory TTL cache
  types.ts           TypeScript types for Buda API responses
  index.ts           stdio MCP server entrypoint
  http.ts            HTTP/SSE MCP server entrypoint
  tools/
    markets.ts       get_markets
    ticker.ts        get_ticker
    orderbook.ts     get_orderbook
    trades.ts        get_trades
    volume.ts        get_market_volume
    spread.ts        get_spread
    compare_markets.ts  compare_markets
    price_history.ts get_price_history
    balances.ts      get_balances (auth)
    orders.ts        get_orders (auth)
    place_order.ts   place_order (auth)
    cancel_order.ts  cancel_order (auth)
marketplace/
  cursor-mcp.json    Cursor MCP config example
  claude-listing.md  Claude registry listing
  openapi.yaml       OpenAPI spec (GPT Actions / HTTP wrapper)
  gemini-tools.json  Gemini function declarations
```

---

## License

MIT — [Buda.com API docs](https://api.buda.com/en/)
