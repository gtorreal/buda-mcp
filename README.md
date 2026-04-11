# buda-mcp

[![npm version](https://img.shields.io/npm/v/@guiie/buda-mcp)](https://www.npmjs.com/package/@guiie/buda-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js >=18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)

MCP server for [Buda.com](https://www.buda.com/) — the leading cryptocurrency exchange in Chile, Colombia, and Peru. Gives any MCP-compatible AI assistant live access to market data, order books, trade history, spreads, technical indicators, and price simulation — no account or API key required.

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

All tools are public — no API key or account required.

#### `get_market_summary` ⭐ Start here
One-call summary: last price, bid/ask, spread %, 24h volume, price change, and `liquidity_rating` (`high` / `medium` / `low`). Best first tool when a user asks about any specific market.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `market_id` | string | Yes | Market ID (e.g. `BTC-CLP`). |

---

#### `get_markets`
List all trading pairs on Buda.com, or get details for a specific market (fees, minimum order size, discount tiers).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `market_id` | string | No | Market ID (e.g. `BTC-CLP`). Omit to list all markets. |

---

#### `get_ticker`
Current snapshot: last price, best bid/ask, 24h volume, and price change over 24h and 7d.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `market_id` | string | Yes | Market ID (e.g. `BTC-CLP`, `ETH-COP`). |

---

#### `get_orderbook`
Current order book: sorted bids and asks as `{price, amount}` objects.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `market_id` | string | Yes | Market ID. |
| `limit` | number | No | Max price levels per side (default: all). |

---

#### `get_trades`
Recent trade history as typed objects: `{timestamp_ms, amount, price, direction}`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `market_id` | string | Yes | Market ID. |
| `limit` | number | No | Number of trades (default 50, max 100). |
| `timestamp` | number | No | Unix seconds — returns trades older than this (pagination). |

---

#### `get_market_volume`
24h and 7-day transacted volume by side (bid = buys, ask = sells).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `market_id` | string | Yes | Market ID. |

---

#### `get_spread`
Bid/ask spread: absolute value and percentage of the ask price.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `market_id` | string | Yes | Market ID. |

---

#### `compare_markets`
Side-by-side ticker data for all pairs of a given base currency across all quote currencies.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `base_currency` | string | Yes | Base currency (e.g. `BTC`, `ETH`). |

---

#### `get_price_history`
OHLCV candles aggregated from raw trade history (Buda has no native candlestick endpoint). Supports `5m`, `15m`, `30m`, `1h`, `4h`, `1d` periods.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `market_id` | string | Yes | Market ID. |
| `period` | string | No | `5m` / `15m` / `30m` / `1h` / `4h` / `1d` (default `1h`). |
| `limit` | number | No | Raw trades to fetch before aggregation (default 100, max 1000). |

---

#### `get_arbitrage_opportunities`
Detects cross-country price discrepancies for an asset across Buda's CLP, COP, and PEN markets, normalized to USDC.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `base_currency` | string | Yes | e.g. `BTC`. |
| `threshold_pct` | number | No | Minimum discrepancy to report (default 0.5). |

---

#### `simulate_order`
Simulates a buy or sell order using live ticker data — no order is ever placed. Returns `estimated_fill_price`, `fee_amount`, `total_cost`, `slippage_vs_mid_pct`. All responses include `simulation: true`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `market_id` | string | Yes | Market ID. |
| `side` | `buy` \| `sell` | Yes | Order side. |
| `amount` | number | Yes | Order size in base currency. |
| `price` | number | No | Omit for market order simulation. |

---

#### `calculate_position_size`
Kelly-style position sizing from capital, risk %, entry, and stop-loss. Fully client-side — no API call.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `market_id` | string | Yes | Market ID (for context). |
| `capital` | number | Yes | Total capital to size from. |
| `risk_pct` | number | Yes | % of capital to risk (0.1–10). |
| `entry_price` | number | Yes | Entry price. |
| `stop_loss_price` | number | Yes | Stop-loss price. |

---

#### `get_market_sentiment`
Composite sentiment score (−100 to +100) from three components: 24h price variation (40%), volume vs 7-day average (35%), spread vs market-type baseline (25%). Returns `score`, `label`, `component_breakdown`, and a `disclaimer`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `market_id` | string | Yes | Market ID. |

---

#### `get_technical_indicators`
RSI (14), MACD (12/26/9), Bollinger Bands (20, 2σ), SMA 20, SMA 50 — computed server-side from Buda trade history (no external libraries). Returns signal interpretations and a structured warning if fewer than 20 candles are available. Includes `disclaimer`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `market_id` | string | Yes | Market ID. |
| `period` | string | No | `1h` / `4h` / `1d` (default `1h`). |
| `limit` | number | No | Raw trades to fetch (500–1000). |

---

#### `get_real_quotation`
Returns a real-time quotation for a given order amount and direction, showing exact fill price, fee, and balance changes without placing an order.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `market_id` | string | Yes | Market ID. |
| `type` | `Bid` \| `Ask` | Yes | Order side. |
| `amount` | number | Yes | Order size in base currency. |
| `limit_price` | number | No | Limit price for limit quotations. |

---

#### `get_available_banks`
Lists available banks for fiat deposits/withdrawals in a given currency's country.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `currency` | string | Yes | Fiat currency code (e.g. `CLP`, `COP`, `PEN`). |

---

## MCP Resources

In addition to tools, the server exposes MCP Resources that clients can read directly:

| URI | Description |
|-----|-------------|
| `buda://markets` | JSON list of all Buda.com markets |
| `buda://ticker/{market}` | JSON ticker for a specific market (e.g. `buda://ticker/BTC-CLP`) |
| `buda://summary/{market}` | Full market summary with liquidity rating (e.g. `buda://summary/BTC-CLP`) |

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

Run tests:

```bash
npm run test:unit        # 100 unit tests, no network required
npm run test:integration # live API tests (skips if unreachable)
npm test                 # both
```

---

## HTTP / Railway deployment

The `dist/http.js` entrypoint runs an Express server with:
- `POST /mcp` — Streamable HTTP MCP transport
- `GET /mcp` — SSE streaming transport
- `GET /health` — health check (`{ status }`)
- `GET /.well-known/mcp/server-card.json` — Smithery-compatible static tool manifest

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | HTTP listen port (default: `3000`) |
| `MCP_RATE_LIMIT` | No | Max requests per IP per minute on `/mcp` (default: `120`) |
| `TRUST_PROXY_HOPS` | No | Number of reverse-proxy hops to trust for `X-Forwarded-For` (default: `1`). |

---

## Security

The server exposes only public Buda.com API endpoints. No credentials are accepted or stored. Input validation is applied to all tool parameters to prevent prompt injection. Error messages are sanitized — internal details (paths, upstream errors) are logged to stderr only and never returned to callers.

### Reporting vulnerabilities

Please report security issues privately via [GitHub Security Advisories](https://github.com/gtorreal/buda-mcp/security/advisories/new) — not as public issues. See [SECURITY.md](SECURITY.md) for the full disclosure policy.

---

## Project structure

```
src/
  client.ts                   BudaClient (HTTP + 429 retry)
  cache.ts                    In-memory TTL cache with in-flight deduplication
  types.ts                    TypeScript types for Buda API responses
  validation.ts               validateMarketId(), validateCurrency()
  utils.ts                    flattenAmount(), aggregateTradesToCandles(), getLiquidityRating()
  version.ts                  Single source of truth for version string
  index.ts                    stdio MCP server entrypoint
  http.ts                     HTTP/SSE MCP server entrypoint
  tools/
    markets.ts                get_markets
    ticker.ts                 get_ticker
    orderbook.ts              get_orderbook
    trades.ts                 get_trades
    volume.ts                 get_market_volume
    spread.ts                 get_spread
    compare_markets.ts        compare_markets
    price_history.ts          get_price_history
    arbitrage.ts              get_arbitrage_opportunities
    market_summary.ts         get_market_summary
    simulate_order.ts         simulate_order
    calculate_position_size.ts calculate_position_size
    market_sentiment.ts       get_market_sentiment
    technical_indicators.ts   get_technical_indicators
    banks.ts                  get_available_banks
    quotation.ts              get_real_quotation
marketplace/
  cursor-mcp.json             Cursor MCP config example
  claude-listing.md           Claude registry listing
  openapi.yaml                OpenAPI spec (GPT Actions / HTTP wrapper)
  gemini-tools.json           Gemini function declarations
```

---

## License

MIT — [Buda.com API docs](https://api.buda.com/en/)
