# Buda.com Market Data

**Category:** Finance / Cryptocurrency  
**Auth:** None required — all tools are public  
**Transport:** stdio  
**npm:** `@guiie/buda-mcp`  
**Registry name:** `io.github.gtorreal/buda-mcp`

---

## Description

Real-time market data from [Buda.com](https://www.buda.com/), the leading cryptocurrency exchange operating in Chile, Colombia, and Peru. All data is sourced from Buda's public REST API v2 — no API key or account required.

Use this server to query live prices, spreads, order books, OHLCV candles, trade history, volume, technical indicators, and cross-market arbitrage opportunities for all BTC, ETH, and altcoin markets quoted in CLP, COP, PEN, and USDC.

---

## Tools

### `get_market_summary` ⭐ Start here
One-call summary of everything relevant about a market: last price, bid/ask, spread %, 24h volume, price change, and `liquidity_rating` ("high" / "medium" / "low"). Best first tool to call when a user asks about any specific market.  
**Parameters:** `market_id` *(required)* — e.g. `BTC-CLP`.

### `get_markets`
Lists all available trading pairs on Buda.com, or returns details for a specific market (fees, minimum order size, discount tiers).  
**Parameters:** `market_id` *(optional)* — e.g. `BTC-CLP`. Omit to list all markets.

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
Bid/ask spread for a market: `best_bid`, `best_ask`, `spread_absolute`, and `spread_percentage` as floats.  
**Parameters:** `market_id` *(required)*.

### `compare_markets`
Side-by-side ticker data for all trading pairs of a given base currency across all supported quote currencies.  
**Parameters:** `base_currency` *(required)* — e.g. `BTC`, `ETH`, `XRP`.

### `get_price_history`
OHLCV candles derived from recent trade history. Supports `5m`, `15m`, `30m`, `1h`, `4h`, `1d` periods.  
**Parameters:** `market_id` *(required)*, `period` *(optional)*, `limit` *(optional, default 100, max 1000 trades)*.

### `get_arbitrage_opportunities`
Detects cross-country price discrepancies for a given asset across Buda's CLP, COP, and PEN markets, normalized to USDC.  
**Parameters:** `base_currency` *(required)* — e.g. `BTC`, `threshold_pct` *(optional, default 0.5)*.

### `simulate_order`
Simulates a buy or sell order using live ticker data — no order is ever placed. Returns `estimated_fill_price`, `fee_amount`, `total_cost`, and `slippage_vs_mid_pct`. All responses include `simulation: true`.  
**Parameters:** `market_id` *(required)*, `side` (`buy`|`sell`) *(required)*, `amount` *(required)*, `price` *(optional)*.

### `calculate_position_size`
Calculates how many units to buy or sell so a stop-loss hit costs exactly `risk_pct`% of `capital`. Fully client-side — no API call.  
**Parameters:** `market_id`, `capital`, `risk_pct` (0.1–10), `entry_price`, `stop_loss_price` *(all required)*.

### `get_market_sentiment`
Composite sentiment score (−100 to +100) from three components: 24h price variation (40%), volume vs 7-day average (35%), spread vs market-type baseline (25%). Returns `score`, `label`, `component_breakdown`, and a `disclaimer`.  
**Parameters:** `market_id` *(required)*.

### `get_technical_indicators`
RSI (14), MACD (12/26/9), Bollinger Bands (20, 2σ), SMA 20, and SMA 50 — computed server-side from Buda trade history (no external libraries). Includes signal interpretations and `disclaimer`.  
**Parameters:** `market_id` *(required)*, `period` (`1h`/`4h`/`1d`, default `1h`), `limit` *(optional)*.

### `get_real_quotation`
Server-side buy or sell quotation from Buda using the live order book. Returns the exact fill price, total cost with fees, and applied fee rate. Does not place an order.  
**Parameters:** `market_id` *(required)*, `type` (`Bid`/`Ask`) *(required)*, `amount` *(required)*, `limit` *(optional)*.

### `get_available_banks`
Banks available for fiat deposits and withdrawals for a given currency. Returns an array of `{ id, name, country }` objects. Cached 60 s.  
**Parameters:** `currency` *(required)* — e.g. `CLP`, `COP`, `PEN`.

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
- *"How much would it cost to buy 0.1 ETH on ETH-CLP right now?"*
- *"How many BTC can I buy with 1M CLP if I risk 2% with a stop at 78M?"*
- *"Is the BTC-CLP market bullish or bearish right now?"*
- *"Is BTC-CLP RSI overbought on the 4-hour chart?"*

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
