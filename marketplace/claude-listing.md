# Buda.com Market Data

**Category:** Finance / Cryptocurrency  
**Auth:** Optional (public mode requires no key; authenticated mode needs `BUDA_API_KEY` + `BUDA_API_SECRET`)  
**Transport:** stdio  
**npm:** `@guiie/buda-mcp`  
**Registry name:** `io.github.gtorreal/buda-mcp`

---

## Description

Real-time market data from [Buda.com](https://www.buda.com/), the leading cryptocurrency exchange operating in Chile, Colombia, and Peru. All public data is sourced from Buda's public REST API v2 — no API key required.

Use this server to query live prices, spreads, order books, OHLCV candles, trade history, volume, and cross-market arbitrage opportunities for all BTC, ETH, and altcoin markets quoted in CLP, COP, PEN, and USDC. Optional API credentials unlock account tools for balances, order management, withdrawals, deposits, and Lightning Network payments.

**v1.5.0** adds 8 new authenticated tools: `cancel_all_orders`, `cancel_order_by_client_id`, `place_batch_orders`, extended `place_order` (TIF + stop), `create_withdrawal`, `create_fiat_deposit`, `lightning_withdrawal`, and `create_lightning_invoice`. All response schemas are flat and fully typed.

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

### `simulate_order`
Simulates a buy or sell order using live ticker data — no order is ever placed. Returns `estimated_fill_price`, `fee_amount`, `fee_currency`, `total_cost`, and `slippage_vs_mid_pct`. All outputs include `simulation: true`. Uses actual taker fee from market data (0.8% crypto / 0.5% stablecoin).  
**Parameters:** `market_id` *(required)*, `side` (`buy`|`sell`) *(required)*, `amount` *(required)*, `price` *(optional — omit for market order simulation)*.

### `calculate_position_size`
Calculates how many units to buy or sell so a stop-loss hit costs exactly `risk_pct`% of `capital`. Fully client-side — no API call. Returns `units`, `capital_at_risk`, `position_value`, `fee_impact`, and a plain-text `risk_reward_note`.  
**Parameters:** `market_id`, `capital`, `risk_pct` (0.1–10), `entry_price`, `stop_loss_price` *(all required)*.

### `get_market_sentiment`
Composite sentiment score (−100 to +100) from three components: 24h price variation (40%), volume vs 7-day daily average (35%), spread vs market-type baseline (25%). Returns `score`, `label` (`bearish`/`neutral`/`bullish`), `component_breakdown`, and a `disclaimer`.  
**Parameters:** `market_id` *(required)*.

### `get_technical_indicators`
RSI (14), MACD (12/26/9), Bollinger Bands (20, 2σ), SMA 20, and SMA 50 — computed server-side from Buda trade history (no external libraries). Returns latest values + signal interpretations. Returns a structured warning if fewer than 50 candles are available after aggregation. Includes `disclaimer`.  
**Parameters:** `market_id` *(required)*, `period` (`1h`/`4h`/`1d`, default `1h`), `limit` *(optional, 500–1000)*.

### `get_available_banks`
Banks available for deposits and withdrawals for a given fiat currency. Returns an array of `{ id, name, country }` objects, or an empty array if none are available. Cached 60 s.  
**Parameters:** `currency` *(required)* — e.g. `CLP`, `COP`, `PEN`.

### `get_real_quotation`
Server-side buy or sell quotation from Buda using the live order book. Returns the exact fill price, total cost with fees, and applied fee rate. Does not place an order.  
**Parameters:** `market_id` *(required)*, `type` (`Bid`/`Ask`) *(required)*, `amount` *(required)*, `limit` *(optional — limit price in quote currency)*.

### Authenticated tools (require `BUDA_API_KEY` + `BUDA_API_SECRET`)

> **Important:** Authenticated instances must run locally only — never expose a server with API credentials publicly.

### `get_account_info`
Returns the authenticated user's profile: email, display name, pubsub key, and monthly transacted amounts. Read-only.

### `get_balances`
All currency balances as flat typed objects: total, available, frozen, and pending withdrawal amounts as floats with `_currency` suffix fields.

### `get_balance`
Balance for a single currency: total, available, frozen, and pending withdrawal amounts as floats with `_currency` fields. Use when you only need one currency instead of fetching all.  
**Parameters:** `currency` *(required)* — e.g. `BTC`, `CLP`, `USDC`.

### `get_orders`
Orders for a given market as flat typed objects. All monetary amounts are floats with `_currency` fields. Filterable by state (`pending`, `active`, `traded`, `canceled`).  
**Parameters:** `market_id` *(required)*, `state` *(optional)*, `per` *(optional)*, `page` *(optional)*.

### `place_order`
Place a limit or market order. Requires `confirmation_token="CONFIRM"` to prevent accidental execution.  
**Parameters:** `market_id`, `type` (Bid/Ask), `price_type` (limit/market), `amount`, `limit_price` *(for limit orders)*, `confirmation_token`.

### `cancel_order`
Cancel an open order by ID. Requires `confirmation_token="CONFIRM"`.  
**Parameters:** `order_id`, `confirmation_token`.

### `cancel_all_orders`
Cancel all open orders in a specific market or across all markets (`market_id="*"`). Requires `confirmation_token="CONFIRM"`. Market validation fires before any API call.  
**Parameters:** `market_id` (or `"*"` for all), `confirmation_token`.

### `cancel_order_by_client_id`
Cancel an open order by its client-assigned string ID. Requires `confirmation_token="CONFIRM"`. Returns the same flat order shape as `get_order`.  
**Parameters:** `client_id`, `confirmation_token`.

### `get_order`
Fetch a single order by its numeric ID with full detail. All monetary amounts are floats with `_currency` fields.  
**Parameters:** `order_id` *(required)*.

### `get_order_by_client_id`
Fetch a single order by the client-assigned string ID set at placement time.  
**Parameters:** `client_id` *(required)*.

### `place_batch_orders`
Place up to 20 orders sequentially. All orders are pre-validated before any API call. Partial failures do not roll back placed orders; a `warning` field surfaces this. Returns `{ results, total, succeeded, failed }`.  
**Parameters:** `orders` (array of 1–20 order objects), `confirmation_token`.

### `get_network_fees`
Fee schedule for deposits or withdrawals of a given currency (name, flat fee, minimum, maximum, and whether the fee is a percentage). Useful before initiating a withdrawal.  
**Parameters:** `currency` *(required)* — e.g. `BTC`, `ETH`, `CLP`. `type` *(required)* — `deposit` or `withdrawal`.

### `get_withdrawal_history`
Withdrawal history for a currency, optionally filtered by state and paginated. Amounts are floats with `_currency` fields.  
**Parameters:** `currency` *(required)*, `state` *(optional: `pending_signature`/`pending`/`confirmed`/`rejected`/`anulled`)*, `per` *(optional)*, `page` *(optional)*.

### `create_withdrawal`
Create a crypto or fiat withdrawal. Exactly one of `address` (crypto) or `bank_account_id` (fiat) must be provided. Requires `confirmation_token="CONFIRM"`.  
**Parameters:** `currency`, `amount`, `address` *(crypto)*, `network` *(optional)*, `bank_account_id` *(fiat)*, `confirmation_token`.

### `get_deposit_history`
Deposit history for a currency, optionally filtered by state and paginated. Amounts are floats with `_currency` fields.  
**Parameters:** `currency` *(required)*, `state` *(optional: `pending_info`/`pending`/`confirmed`/`anulled`/`retained`)*, `per` *(optional)*, `page` *(optional)*.

### `create_fiat_deposit`
Record a fiat deposit. Guard is critical — calling twice creates duplicates. Requires `confirmation_token="CONFIRM"`.  
**Parameters:** `currency`, `amount`, `bank` *(optional)*, `confirmation_token`.

### `lightning_withdrawal`
Pay a BOLT-11 Lightning invoice from the LN-BTC reserve. Requires `confirmation_token="CONFIRM"`. Returns `{ id, state, amount, fee, payment_hash, created_at }`.  
**Parameters:** `invoice`, `confirmation_token`.

### `create_lightning_invoice`
Create a Lightning receive invoice. No confirmation required. Returns `{ id, payment_request, amount_satoshis, description, expires_at, state, created_at }`.  
**Parameters:** `amount_satoshis`, `description` *(optional, max 140 chars)*, `expiry_seconds` *(optional, 60–86400)*.

### `create_receive_address`
Generate a new crypto deposit address for a currency. Not idempotent — each call creates a new address. Crypto only.  
**Parameters:** `currency` *(required)* — e.g. `BTC`, `ETH`.

### `list_receive_addresses`
List all receive (deposit) addresses for a currency.  
**Parameters:** `currency` *(required)*.

### `get_receive_address`
Fetch a specific receive address by its numeric ID.  
**Parameters:** `currency` *(required)*, `id` *(required)*.

### `list_remittance_recipients`
List saved remittance recipients (bank accounts) for fiat transfers, with pagination.  
**Parameters:** `per` *(optional)*, `page` *(optional)*.

### `get_remittance_recipient`
Fetch a single saved remittance recipient by ID.  
**Parameters:** `id` *(required)*.

### `list_remittances`
List past fiat remittance transfers with pagination. Amounts are floats with `_currency` fields.  
**Parameters:** `per` *(optional)*, `page` *(optional)*.

### `quote_remittance`
Create a time-limited remittance quote (does not transfer funds). Follow with `accept_remittance_quote` to execute. Not idempotent.  
**Parameters:** `currency` *(required)*, `amount` *(required)*, `recipient_id` *(required)*.

### `accept_remittance_quote`
Accept and execute a remittance quote. **Irreversible.** Requires `confirmation_token="CONFIRM"`.  
**Parameters:** `id` *(required — quote ID)*, `confirmation_token`.

### `get_remittance`
Fetch the status and details of a single remittance by ID.  
**Parameters:** `id` *(required)*.

### `schedule_cancel_all`
**WARNING: timer state is lost on server restart. Use only on locally-run instances.**  
Arms an in-memory dead man's switch: if not renewed within `ttl_seconds`, all open orders for the market are automatically cancelled. Requires `confirmation_token="CONFIRM"`.  
**Parameters:** `market_id`, `ttl_seconds` (10–300), `confirmation_token`.

### `renew_cancel_timer`
Resets the dead man's switch TTL for a market. No confirmation required. Must have an active timer.  
**Parameters:** `market_id`.

### `disarm_cancel_timer`
Disarms the dead man's switch without cancelling any orders. Safe to call even with no active timer.  
**Parameters:** `market_id`.

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
- *"How much would it cost to buy 0.1 ETH on ETH-CLP right now?"*
- *"How many BTC can I buy with 1M CLP if I risk 2% with a stop at 78M?"*
- *"Is the BTC-CLP market bullish or bearish right now?"*
- *"Is BTC-CLP RSI overbought on the 4-hour chart?"*
- *"Arm a 60-second dead man's switch for my BTC-CLP orders."* *(authenticated)*

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
