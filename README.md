# buda-mcp

[![npm version](https://img.shields.io/npm/v/@guiie/buda-mcp)](https://www.npmjs.com/package/@guiie/buda-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js >=18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)

MCP server for [Buda.com](https://www.buda.com/) — the leading cryptocurrency exchange in Chile, Colombia, and Peru. Gives any MCP-compatible AI assistant live access to market data, order books, trade history, spreads, and (when credentials are provided) full private account tools including order management, withdrawals, deposits, and Lightning Network payments.

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

#### `get_market_summary` ⭐ Start here
One-call summary: last price, bid/ask, spread %, 24h volume, price change, and `liquidity_rating` (`high` / `medium` / `low`). Best first tool when a user asks about any specific market.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `market_id` | string | Yes | Market ID (e.g. `BTC-CLP`). |

---

#### `get_markets`
List all 26 trading pairs on Buda.com, or get details for a specific market (fees, minimum order size, discount tiers).

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

### Authenticated tools

Available only when `BUDA_API_KEY` and `BUDA_API_SECRET` environment variables are set. See [Authentication mode](#authentication-mode) below.

> **Warning:** Authenticated instances must be run **locally only**. Never expose a server with API credentials to the internet.

#### `get_account_info`
Returns the authenticated account profile: email, name, and monthly transacted amount.

---

#### `get_balances`
All currency balances: total, available, frozen, and pending withdrawal — as floats with `_currency` fields.

**Example prompts:**
- *"What's my BTC balance on Buda?"*
- *"Show all my balances"*

---

#### `get_balance`
Balance for a single currency.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `currency` | string | Yes | Currency code (e.g. `BTC`, `CLP`). |

---

#### `get_orders`
Orders for a given market, filterable by state.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `market_id` | string | Yes | Market ID. |
| `state` | string | No | `pending`, `active`, `traded`, `canceled`, `canceled_and_traded`. |
| `per` | number | No | Results per page (default 20, max 300). |
| `page` | number | No | Page number (default 1). |

---

#### `get_order`
Returns a single order by its numeric ID.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `order_id` | number | Yes | Numeric order ID. |

---

#### `get_order_by_client_id`
Returns an order by the client-assigned string ID set at placement.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `client_id` | string | Yes | Client ID string. |

---

#### `place_order`
Place a limit or market order. Supports optional time-in-force flags and stop orders.

**Requires `confirmation_token="CONFIRM"`** — prevents accidental execution.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `market_id` | string | Yes | Market ID. |
| `type` | `Bid` \| `Ask` | Yes | Order side. |
| `price_type` | `limit` \| `market` | Yes | Order type. |
| `amount` | number | Yes | Order size in base currency. |
| `limit_price` | number | No | Required for limit orders. |
| `ioc` | boolean | No | Immediate-or-cancel. Mutually exclusive with `fok`, `post_only`, `gtd_timestamp`. |
| `fok` | boolean | No | Fill-or-kill. Mutually exclusive with other TIF flags. |
| `post_only` | boolean | No | Rejected if it would execute as taker. Mutually exclusive with other TIF flags. |
| `gtd_timestamp` | string | No | Good-till-date (ISO 8601). Mutually exclusive with other TIF flags. |
| `stop_price` | number | No | Stop trigger price. Must be paired with `stop_type`. |
| `stop_type` | `>=` \| `<=` | No | Stop trigger direction. Must be paired with `stop_price`. |
| `confirmation_token` | string | Yes | Must equal `"CONFIRM"` to execute. |

---

#### `cancel_order`
Cancel an open order by numeric ID.

**Requires `confirmation_token="CONFIRM"`**.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `order_id` | number | Yes | Numeric order ID. |
| `confirmation_token` | string | Yes | Must equal `"CONFIRM"` to cancel. |

---

#### `cancel_order_by_client_id`
Cancel an open order by its client-assigned string ID.

**Requires `confirmation_token="CONFIRM"`**.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `client_id` | string | Yes | Client ID string. |
| `confirmation_token` | string | Yes | Must equal `"CONFIRM"` to cancel. |

---

#### `cancel_all_orders`
Cancel all open orders in a specific market or across all markets.

**Requires `confirmation_token="CONFIRM"`**.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `market_id` | string | Yes | Market ID (e.g. `BTC-CLP`) or `"*"` to cancel all markets. |
| `confirmation_token` | string | Yes | Must equal `"CONFIRM"` to cancel. |

---

#### `place_batch_orders`
Place up to 20 orders sequentially. All orders are pre-validated before any API call — a validation failure aborts with zero orders placed. Partial API failures do not roll back placed orders; a `warning` field surfaces this.

**Requires `confirmation_token="CONFIRM"`**.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `orders` | array | Yes | Array of 1–20 order objects (`market_id`, `type`, `price_type`, `amount`, optional `limit_price`). |
| `confirmation_token` | string | Yes | Must equal `"CONFIRM"` to execute. |

---

#### `get_network_fees`
Returns withdrawal fee information for a currency.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `currency` | string | Yes | Currency code (e.g. `BTC`, `ETH`). |

---

#### `get_deposit_history`
Deposit history for a currency, filterable by state with pagination.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `currency` | string | Yes | Currency code. |
| `state` | string | No | `pending_info`, `pending`, `confirmed`, `anulled`, `retained`. |
| `per` | number | No | Results per page (default 20, max 300). |
| `page` | number | No | Page number (default 1). |

---

#### `create_fiat_deposit`
Record a fiat deposit. **Calling twice creates duplicate records — the confirmation guard is critical.**

**Requires `confirmation_token="CONFIRM"`**.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `currency` | string | Yes | Fiat currency code (e.g. `CLP`, `COP`, `PEN`). |
| `amount` | number | Yes | Deposit amount. |
| `bank` | string | No | Bank name or identifier. |
| `confirmation_token` | string | Yes | Must equal `"CONFIRM"` to execute. |

---

#### `get_withdrawal_history`
Withdrawal history for a currency, filterable by state with pagination.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `currency` | string | Yes | Currency code. |
| `state` | string | No | `pending_signature`, `pending`, `confirmed`, `rejected`, `anulled`. |
| `per` | number | No | Results per page (default 20, max 300). |
| `page` | number | No | Page number (default 1). |

---

#### `create_withdrawal`
Create a crypto or fiat withdrawal. Exactly one of `address` (crypto) or `bank_account_id` (fiat) must be provided.

**Requires `confirmation_token="CONFIRM"`**.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `currency` | string | Yes | Currency code (e.g. `BTC`, `CLP`). |
| `amount` | number | Yes | Withdrawal amount. |
| `address` | string | No | Destination crypto address. Mutually exclusive with `bank_account_id`. |
| `network` | string | No | Blockchain network (e.g. `bitcoin`, `ethereum`). |
| `bank_account_id` | number | No | Fiat bank account ID. Mutually exclusive with `address`. |
| `confirmation_token` | string | Yes | Must equal `"CONFIRM"` to execute. |

---

#### `list_receive_addresses`
Lists all receive addresses for a currency.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `currency` | string | Yes | Currency code (e.g. `BTC`). |

---

#### `get_receive_address`
Returns the current active receive address for a currency.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `currency` | string | Yes | Currency code. |

---

#### `create_receive_address`
Generate a new receive address for a crypto currency. Not idempotent — each call creates a distinct address.

**Requires `confirmation_token="CONFIRM"`**.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `currency` | string | Yes | Crypto currency code (e.g. `BTC`, `ETH`). |
| `confirmation_token` | string | Yes | Must equal `"CONFIRM"` to generate a new address. |

---

#### `list_remittances`
Lists remittances on the account with pagination.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `per` | number | No | Results per page (default 20, max 300). |
| `page` | number | No | Page number (default 1). |

---

#### `get_remittance`
Returns a single remittance by ID.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | number | Yes | Remittance ID. |

---

#### `quote_remittance`
Request a remittance quote for a given recipient and amount. Not idempotent — each call creates a new remittance record.

**Requires `confirmation_token="CONFIRM"`**.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `currency` | string | Yes | Currency code. |
| `amount` | number | Yes | Amount to remit. |
| `recipient_id` | number | Yes | Remittance recipient ID. |
| `confirmation_token` | string | Yes | Must equal `"CONFIRM"` to create the quote. |

---

#### `accept_remittance_quote`
Accept a remittance quote to execute the transfer.

**Requires `confirmation_token="CONFIRM"`**.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | number | Yes | Remittance ID to accept. |
| `confirmation_token` | string | Yes | Must equal `"CONFIRM"` to execute. |

---

#### `list_remittance_recipients`
Lists saved remittance recipients with pagination.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `per` | number | No | Results per page. |
| `page` | number | No | Page number. |

---

#### `get_remittance_recipient`
Returns a single remittance recipient by ID.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | number | Yes | Recipient ID. |

---

#### `lightning_withdrawal`
Pay a Bitcoin Lightning Network BOLT-11 invoice from the LN-BTC reserve. Funds leave immediately on success.

**Requires `confirmation_token="CONFIRM"`**.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `invoice` | string | Yes | BOLT-11 invoice string (starts with `lnbc`, `lntb`, etc.). |
| `confirmation_token` | string | Yes | Must equal `"CONFIRM"` to execute. |

---

#### `create_lightning_invoice`
Create a Bitcoin Lightning Network receive invoice. No confirmation required — no funds leave the account.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `amount_satoshis` | number | Yes | Invoice amount in satoshis. |
| `description` | string | No | Payment description (max 140 characters). |
| `expiry_seconds` | number | No | Invoice expiry in seconds (60–86400, default 3600). |

---

#### `schedule_cancel_all`
Arms an in-memory dead man's switch: if not renewed within `ttl_seconds`, all open orders for the market are automatically cancelled.

**Requires `confirmation_token="CONFIRM"`**.

> **Warning:** Timer state is lost on server restart. Use only on locally-run instances — never Railway or hosted deployments.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `market_id` | string | Yes | Market ID to cancel orders for. |
| `ttl_seconds` | number | Yes | Seconds before auto-cancel fires (10–300). |
| `confirmation_token` | string | Yes | Must equal `"CONFIRM"` to arm. |

---

#### `renew_cancel_timer`
Resets the dead man's switch TTL for a market. No confirmation required.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `market_id` | string | Yes | Market ID. |

---

#### `disarm_cancel_timer`
Disarms the dead man's switch without cancelling any orders. Safe to call with no active timer.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `market_id` | string | Yes | Market ID. |

---

## MCP Resources

In addition to tools, the server exposes MCP Resources that clients can read directly:

| URI | Description |
|-----|-------------|
| `buda://markets` | JSON list of all Buda.com markets |
| `buda://ticker/{market}` | JSON ticker for a specific market (e.g. `buda://ticker/BTC-CLP`) |
| `buda://summary/{market}` | Full market summary with liquidity rating (e.g. `buda://summary/BTC-CLP`) |

---

## Authentication mode

The server defaults to **public-only mode** — no API key needed, no breaking changes for existing users.

To enable authenticated tools, set environment variables before running:

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

Run tests:

```bash
npm run test:unit        # 138 unit tests, no network required
npm run test:integration # live API tests (skips if unreachable)
npm test                 # both
```

---

## Security

### Recommended deployment: stdio (local)

The safest way to use buda-mcp is the default one — running it locally via `npx` as a stdio process inside your MCP client (Claude Desktop, Cursor, Claude Code). In this mode:

- Your Buda API credentials are set as environment variables on your own machine and never leave it
- There is no network socket — the transport is an in-process pipe
- There is no bearer token to manage or rotate

**For personal use, this is the only deployment model you need.**

### Self-hosting the HTTP server

The HTTP server (`npm start`) is designed for single-tenant deployments where you want to access your Buda account from a remote AI client. If you run it:

- **TLS is mandatory when credentials are configured.** Deploy behind a TLS-terminating proxy (Railway, Nginx, Caddy). Running over plain HTTP exposes your API key, secret, and bearer token to network interception. The server will warn at startup if `TRUST_PROXY_HOPS=0` and credentials are set.
- **`MCP_AUTH_TOKEN` is the only security boundary.** Anyone who holds a valid token has full account access — including placing orders, creating withdrawals, and making Lightning payments. Treat it with the same care as your Buda API secret.
- **`confirmation_token='CONFIRM'` is a UX guard, not a cryptographic gate.** It prevents accidental execution by AI agents acting on ambiguous prompts. It does not prevent a determined caller with a valid bearer token from executing any operation.

### Reporting vulnerabilities

Please report security issues privately via [GitHub Security Advisories](https://github.com/gtorreal/buda-mcp/security/advisories/new) — not as public issues. See [SECURITY.md](SECURITY.md) for the full disclosure policy and scope definition.

---

## HTTP / Railway deployment

The `dist/http.js` entrypoint runs an Express server with:
- `POST /mcp` — Streamable HTTP MCP transport
- `GET /mcp` — SSE streaming transport
- `GET /health` — health check (`{ status, version, auth_mode }`)
- `GET /.well-known/mcp/server-card.json` — Smithery-compatible static tool manifest

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | HTTP listen port (default: `3000`) |
| `MCP_AUTH_TOKEN` | **Yes, when credentials are set** | Bearer token that all `/mcp` requests must include (`Authorization: Bearer <token>`). If `BUDA_API_KEY`/`BUDA_API_SECRET` are set but this is absent, the server refuses to start. |
| `MCP_RATE_LIMIT` | No | Max requests per IP per minute on `/mcp` (default: `120`) |
| `BUDA_API_KEY` | No | Buda.com API key — enables auth-gated tools |
| `BUDA_API_SECRET` | No | Buda.com API secret — required together with `BUDA_API_KEY` |

> **Security:** Never expose the HTTP server publicly without setting `MCP_AUTH_TOKEN`. The server will exit at startup if credentials are present but the token is missing.

---

## Project structure

```
src/
  client.ts                   BudaClient (HTTP + HMAC auth + 429 retry)
  cache.ts                    In-memory TTL cache with in-flight deduplication
  types.ts                    TypeScript types for Buda API responses
  validation.ts               validateMarketId(), validateCurrency(), validateCryptoAddress()
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
    account.ts                get_account_info (auth)
    balance.ts                get_balance (auth)
    balances.ts               get_balances (auth)
    orders.ts                 get_orders (auth)
    order_lookup.ts           get_order, get_order_by_client_id (auth)
    place_order.ts            place_order (auth)
    cancel_order.ts           cancel_order (auth)
    cancel_all_orders.ts      cancel_all_orders (auth)
    cancel_order_by_client_id.ts  cancel_order_by_client_id (auth)
    batch_orders.ts           place_batch_orders (auth)
    fees.ts                   get_network_fees (auth)
    deposits.ts               get_deposit_history, create_fiat_deposit (auth)
    withdrawals.ts            get_withdrawal_history, create_withdrawal (auth)
    receive_addresses.ts      list/get/create_receive_address (auth)
    remittances.ts            list/get/quote/accept remittances (auth)
    remittance_recipients.ts  list/get remittance recipients (auth)
    lightning.ts              lightning_withdrawal, create_lightning_invoice (auth)
    dead_mans_switch.ts       schedule_cancel_all, renew/disarm_cancel_timer (auth)
marketplace/
  cursor-mcp.json             Cursor MCP config example
  claude-listing.md           Claude registry listing
  openapi.yaml                OpenAPI spec (GPT Actions / HTTP wrapper)
  gemini-tools.json           Gemini function declarations
```

---

## License

MIT — [Buda.com API docs](https://api.buda.com/en/)
