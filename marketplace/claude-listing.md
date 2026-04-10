# Buda.com Market Data

**Category:** Finance / Cryptocurrency  
**Auth:** None required  
**Transport:** stdio  
**npm:** `@gtorreal/buda-mcp`  
**Registry name:** `io.github.gtorreal/buda-mcp`

---

## Description

Real-time market data from [Buda.com](https://www.buda.com/), the leading cryptocurrency exchange operating in Chile, Colombia, and Peru. All data is sourced from Buda's public REST API v2 — no API key required.

Use this server to query live prices, order books, trade history, and volume for all BTC, ETH, and altcoin markets quoted in CLP, COP, and PEN.

---

## Tools

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

---

## Example prompts

- *"What is the current Bitcoin price in Chilean pesos?"*
- *"Show me the BTC-CLP order book — top 10 bids and asks."*
- *"How much ETH was traded on Buda in the last 7 days?"*
- *"List all markets available on Buda.com."*
- *"What's the spread on BTC-COP right now?"*

---

## Installation

**Claude Code (claude CLI)**
```bash
claude mcp add buda-mcp -- npx -y @gtorreal/buda-mcp
```

**Claude Desktop (`claude_desktop_config.json`)**
```json
{
  "mcpServers": {
    "buda-mcp": {
      "command": "npx",
      "args": ["-y", "@gtorreal/buda-mcp"]
    }
  }
}
```

**From source**
```bash
git clone https://github.com/gtorreal/buda-mcp.git
cd buda-mcp && npm install && npm run build
# Then point to: node /absolute/path/buda-mcp/dist/index.js
```

---

## Markets covered

| Quote | Country | Sample pairs |
|---|---|---|
| CLP | Chile | BTC-CLP, ETH-CLP, XRP-CLP |
| COP | Colombia | BTC-COP, ETH-COP, XRP-COP |
| PEN | Peru | BTC-PEN, ETH-PEN |
| BTC | Cross | ETH-BTC, XRP-BTC, BCH-BTC |

---

## Source

- GitHub: https://github.com/gtorreal/buda-mcp  
- npm: https://www.npmjs.com/package/@gtorreal/buda-mcp  
- Buda.com API docs: https://api.buda.com/en/
