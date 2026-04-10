# buda-mcp

A production-ready [MCP](https://modelcontextprotocol.io/) server for the [Buda.com](https://www.buda.com/) cryptocurrency exchange public API. Exposes real-time market data tools to any MCP-compatible AI client (Claude Code, Cursor, ChatGPT, etc.).

## Tools

| Tool | Description |
|---|---|
| `get_markets` | List all trading pairs, or get details for one market |
| `get_ticker` | Current price, bid/ask, volume, and price change for a market |
| `get_orderbook` | Full order book (bids + asks) for a market |
| `get_trades` | Recent trade history for a market |
| `get_market_volume` | 24h and 7-day transacted volume for a market |

All tools use Buda.com's **public** endpoints — no API key required.

## Requirements

- Node.js 18+
- npm 8+

## Installation

```bash
git clone https://github.com/gtorreal/buda-mcp.git
cd buda-mcp
npm install
npm run build
```

## Running the test suite

Calls each tool against the live Buda API and prints the results:

```bash
npm test
```

## Usage

### Claude Code

Add the server with the `claude` CLI:

```bash
claude mcp add buda-mcp -- node /absolute/path/to/buda-mcp/dist/index.js
```

Then ask Claude things like:

> What is the current BTC-CLP price?
> Show me the order book for ETH-CLP.
> How much Bitcoin was traded in the last 7 days on BTC-CLP?

### Cursor

Add to `.cursor/mcp.json` in your project (or `~/.cursor/mcp.json` globally):

```json
{
  "mcpServers": {
    "buda-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/buda-mcp/dist/index.js"]
    }
  }
}
```

Restart Cursor and the tools will be available to the AI agent in chat.

### ChatGPT (Actions / Custom GPT)

ChatGPT does not natively support the stdio MCP transport. To use this server with ChatGPT you need an HTTP bridge. The simplest option is [mcp-server-proxy](https://github.com/sparfenyuk/mcp-proxy):

```bash
pip install mcp-proxy
mcp-proxy --port 8000 -- node /absolute/path/to/buda-mcp/dist/index.js
```

Then register `http://localhost:8000` (or your deployed URL) as a GPT Action endpoint. Use the auto-generated OpenAPI schema that `mcp-proxy` exposes at `/openapi.json`.

## Project structure

```
src/
  index.ts          — MCP server entry point
  client.ts         — BudaClient HTTP wrapper (extend here for auth)
  types.ts          — TypeScript types for all API responses
  tools/
    markets.ts      — get_markets
    ticker.ts       — get_ticker
    orderbook.ts    — get_orderbook
    trades.ts       — get_trades
    volume.ts       — get_market_volume
test/
  run-all.ts        — integration test script
```

## Adding private endpoints

`BudaClient` in `src/client.ts` is structured for easy extension. To add authenticated endpoints (balances, orders, withdrawals):

1. Add `apiKey` and `apiSecret` constructor parameters.
2. Implement HMAC-SHA2 signing in a `signedGet` / `signedPost` method (see [Buda auth docs](https://api.buda.com/en/#rest-api-private-endpoints-authentication)).
3. Drop new tool files under `src/tools/` and call `register(server, client)` in `src/index.ts`.

## Markets available

Buda.com operates in Chile, Colombia, and Peru:

| Quote currency | Country |
|---|---|
| CLP | Chile |
| COP | Colombia |
| PEN | Peru |

Common markets: `BTC-CLP`, `ETH-CLP`, `BTC-COP`, `ETH-COP`, `BTC-PEN`, `ETH-PEN`, `ETH-BTC`, `XRP-BTC`, etc.

## License

MIT
