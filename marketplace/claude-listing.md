# Buda.com Market Data

**Category:** Finance / Cryptocurrency  
**Auth:** Optional (public mode requires no key; authenticated mode needs `BUDA_API_KEY` + `BUDA_API_SECRET`)  
**Transport:** stdio  
**npm:** `@guiie/buda-mcp`  
**Registry name:** `io.github.gtorreal/buda-mcp`

---

## Description

Real-time market data from [Buda.com](https://www.buda.com/), the leading cryptocurrency exchange operating in Chile, Colombia, and Peru. All public data is sourced from Buda's public REST API v2 — no API key required.

Use this server to query live prices, spreads, order books, OHLCV candles, trade history, and volume for all BTC, ETH, and altcoin markets quoted in CLP, COP, PEN, and USDC. Optional API credentials unlock account tools for balances and order management.

---

## Tools

### Public tools (no credentials required)

### `get_markets`
List all available trading pairs on Buda.com, or retrieve details for a specific market.  
Returns: base/quote currencies, trading fees, minimum order amounts, fee discount tiers.  
**Parameters:** `market_id` *(optional)* — e.g. `BTC-CLP`. Omit to list all 26 markets.

### `get_ticker`
Current market snapshot: last traded price, best bid and ask, 24h volume, and price change over 24h and 7d.  
**Parameters:** `market_id` *(required)* — e.g. `BTC-CLP`, `ETH-COP`, `ETH-BTC`.

### `get_orderbook`
Full order book for a market: sorted bids and asks as `[price, amount]` pairs.  
**Parameters:** `market_id` *(required)*, `limit` *(optional)* — cap levels returned per side.

### `get_trades`
Recent trade history. Each entry: `[timestamp_ms, amount, price, direction]`.  
**Parameters:** `market_id` *(required)*, `limit` *(optional, max 100)*, `timestamp` *(optional, for pagination)*.

### `get_market_volume`
24h and 7-day transacted volume broken down by buy (bid) and sell (ask) side.  
**Parameters:** `market_id` *(required)*.

### `get_spread`
Bid/ask spread for a market: absolute spread and spread as a percentage of the ask price.  
**Parameters:** `market_id` *(required)*.

### `compare_markets`
Side-by-side ticker data for all trading pairs of a given base currency across all supported quote currencies.  
**Parameters:** `base_currency` *(required)* — e.g. `BTC`, `ETH`, `XRP`.

### `get_price_history`
OHLCV (open/high/low/close/volume) candles derived from recent trade history. Supports `1h`, `4h`, and `1d` periods.  
**Parameters:** `market_id` *(required)*, `period` *(optional: `1h`/`4h`/`1d`, default `1h`)*, `limit` *(optional, max 100 trades)*.

### Authenticated tools (require `BUDA_API_KEY` + `BUDA_API_SECRET`)

> **Important:** Authenticated instances must run locally only — never expose a server with API credentials publicly.

### `get_balances`
All currency balances: total, available, frozen, and pending withdrawal amounts.

### `get_orders`
Orders for a given market, filterable by state (`pending`, `active`, `traded`, `canceled`).  
**Parameters:** `market_id` *(required)*, `state` *(optional)*, `per` *(optional)*, `page` *(optional)*.

### `place_order`
Place a limit or market order. Requires `confirmation_token="CONFIRM"` to prevent accidental execution.  
**Parameters:** `market_id`, `type` (Bid/Ask), `price_type` (limit/market), `amount`, `limit_price` *(for limit orders)*, `confirmation_token`.

### `cancel_order`
Cancel an open order by ID. Requires `confirmation_token="CONFIRM"`.  
**Parameters:** `order_id`, `confirmation_token`.

---

## MCP Resources

| URI | Description |
|-----|-------------|
| `buda://markets` | JSON list of all Buda.com markets |
| `buda://ticker/{market}` | JSON ticker for a specific market |

---

## Example prompts

- *"What is the current Bitcoin price in Chilean pesos?"*
- *"Show me the BTC-CLP order book — top 10 bids and asks."*
- *"How much ETH was traded on Buda in the last 7 days?"*
- *"List all markets available on Buda.com."*
- *"What's the spread on BTC-COP right now?"*
- *"Compare the Bitcoin price across all Buda markets."*
- *"Show me hourly BTC-CLP candles."*
- *"What's my available BTC balance?"* *(authenticated)*
- *"Show my open orders on BTC-CLP."* *(authenticated)*

---

## Installation

**Quick start (npx)**
```bash
npx @guiie/buda-mcp
```

**Claude Code (claude CLI)**
```bash
claude mcp add buda-mcp -- npx -y @guiie/buda-mcp
```

**Claude Desktop (`claude_desktop_config.json`)**
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

**With authentication**
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

**From source**
```bash
git clone https://github.com/gtorreal/buda-mcp.git
cd buda-mcp && npm install && npm run build
node dist/index.js
```

---

## Markets covered

| Quote | Country | Sample pairs |
|---|---|---|
| CLP | Chile | BTC-CLP, ETH-CLP, XRP-CLP |
| COP | Colombia | BTC-COP, ETH-COP, XRP-COP |
| PEN | Peru | BTC-PEN, ETH-PEN |
| USDC | USD-pegged | BTC-USDC, ETH-USDC |
| BTC | Cross | ETH-BTC, XRP-BTC, BCH-BTC |

---

## Source

- GitHub: https://github.com/gtorreal/buda-mcp  
- npm: https://www.npmjs.com/package/@guiie/buda-mcp  
- Buda.com API docs: https://api.buda.com/en/
