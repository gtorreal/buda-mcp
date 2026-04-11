# Buda.com Market Data

**Category:** Finance / Cryptocurrency  
**Auth:** Optional (public mode requires no key; authenticated mode needs `BUDA_API_KEY` + `BUDA_API_SECRET`)  
**Transport:** stdio  
**npm:** `@guiie/buda-mcp`  
**Registry name:** `io.github.gtorreal/buda-mcp`

---

## Description

Real-time market data from [Buda.com](https://www.buda.com/), the leading cryptocurrency exchange operating in Chile, Colombia, and Peru. All public data is sourced from Buda's public REST API v2 — no API key required.

Use this server to query live prices, spreads, order books, OHLCV candles, trade history, volume, and cross-market arbitrage opportunities for all BTC, ETH, and altcoin markets quoted in CLP, COP, PEN, and USDC. Optional API credentials unlock account tools for balances and order management.

**v1.3.0 output quality improvements:** All response schemas are now flat and fully typed — monetary amounts are returned as floats with separate `_currency` fields instead of `["amount", "currency"]` arrays, making responses directly usable by LLMs without parsing.

---

## Tools

### Public tools (no credentials required)

### `get_market_summary` ⭐ Start here
One-call summary of everything relevant about a market: last price, bid/ask, spread %, 24h volume, price change, and `liquidity_rating` ("high" / "medium" / "low"). Best first tool to call when a user asks about any specific market.  
**Parameters:** `market_id` *(required)* — e.g. `BTC-CLP`.

### `get_markets`
Lists all available trading pairs on Buda.com, or returns details for a specific market (fees, minimum order size, discount tiers).  
**Parameters:** `market_id` *(optional)* — e.g. `BTC-CLP`. Omit to list all 26 markets.

### `get_ticker`
Current market snapshot: last traded price, best bid and ask, 24h volume, and price change over 24h and 7d. All values are floats in the quote currency.  
**Parameters:** `market_id` *(required)* — e.g. `BTC-CLP`, `ETH-COP`, `ETH-BTC`.

### `get_orderbook`
Full order book for a market: bids and asks as `{price, amount}` objects (floats). Bids sorted highest-first, asks lowest-first.  
**Parameters:** `market_id` *(required)*, `limit` *(optional)* — cap levels returned per side.

### `get_trades`
Recent trade history as typed objects: `{timestamp_ms, amount, price, direction}` with all numeric fields as floats.  
**Parameters:** `market_id` *(required)*, `limit` *(optional, max 100)*, `timestamp` *(optional, for pagination)*.

### `get_market_volume`
24h and 7-day transacted volume as floats broken down by buy (bid) and sell (ask) side.  
**Parameters:** `market_id` *(required)*.

### `get_spread`
Bid/ask spread for a market: `best_bid`, `best_ask`, `spread_absolute`, and `spread_percentage` as floats. `spread_percentage` is in percent (e.g. 0.15 = 0.15%).  
**Parameters:** `market_id` *(required)*.

### `compare_markets`
Side-by-side ticker data for all trading pairs of a given base currency across all supported quote currencies. `price_change_*` fields are floats in percent.  
**Parameters:** `base_currency` *(required)* — e.g. `BTC`, `ETH`, `XRP`.

### `get_price_history`
OHLCV (open/high/low/close/volume) candles derived from recent trade history (Buda has no native candlestick endpoint). All candle values are floats. Supports `1h`, `4h`, and `1d` periods.  
**Parameters:** `market_id` *(required)*, `period` *(optional: `1h`/`4h`/`1d`, default `1h`)*, `limit` *(optional, default 100, max 1000 trades)*.

### `get_arbitrage_opportunities`
Detects cross-country price discrepancies for a given asset across Buda's CLP, COP, and PEN markets, normalized to USDC. Returns pairwise discrepancies above `threshold_pct` sorted by size. Includes a `fees_note` reminding that Buda's 0.8% taker fee per leg (~1.6% round-trip) must be deducted.  
**Parameters:** `base_currency` *(required)* — e.g. `BTC`, `threshold_pct` *(optional, default 0.5)*.

### Authenticated tools (require `BUDA_API_KEY` + `BUDA_API_SECRET`)

> **Important:** Authenticated instances must run locally only — never expose a server with API credentials publicly.

### `get_balances`
All currency balances as flat typed objects: total, available, frozen, and pending withdrawal amounts as floats with `_currency` suffix fields.

### `get_orders`
Orders for a given market as flat typed objects. All monetary amounts are floats with `_currency` fields. Filterable by state (`pending`, `active`, `traded`, `canceled`).  
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
| `buda://ticker/{market}` | Raw ticker for a specific market |
| `buda://summary/{market}` | Full market summary with liquidity rating |

---

## Example prompts

- *"Give me a complete overview of the BTC-CLP market."*
- *"What is the current Bitcoin price in Chilean pesos?"*
- *"Is there an arbitrage opportunity for BTC between Chile and Peru?"*
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
