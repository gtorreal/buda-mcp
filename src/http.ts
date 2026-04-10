import express from "express";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { BudaClient } from "./client.js";
import { MemoryCache, CACHE_TTL } from "./cache.js";
import type { MarketsResponse, TickerResponse } from "./types.js";
import * as markets from "./tools/markets.js";
import * as ticker from "./tools/ticker.js";
import * as orderbook from "./tools/orderbook.js";
import * as trades from "./tools/trades.js";
import * as volume from "./tools/volume.js";
import * as spread from "./tools/spread.js";
import * as compareMarkets from "./tools/compare_markets.js";
import * as priceHistory from "./tools/price_history.js";
import * as balances from "./tools/balances.js";
import * as orders from "./tools/orders.js";
import * as placeOrder from "./tools/place_order.js";
import * as cancelOrder from "./tools/cancel_order.js";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

const client = new BudaClient(
  undefined,
  process.env.BUDA_API_KEY,
  process.env.BUDA_API_SECRET,
);

const authEnabled = client.hasAuth();

function createServer(): McpServer {
  const server = new McpServer({ name: "buda-mcp", version: "1.1.2" });

  // Per-request cache so caching works correctly for stateless HTTP
  const reqCache = new MemoryCache();

  markets.register(server, client, reqCache);
  ticker.register(server, client, reqCache);
  orderbook.register(server, client, reqCache);
  trades.register(server, client, reqCache);
  volume.register(server, client, reqCache);
  spread.register(server, client, reqCache);
  compareMarkets.register(server, client, reqCache);
  priceHistory.register(server, client, reqCache);

  if (authEnabled) {
    balances.register(server, client);
    orders.register(server, client);
    placeOrder.register(server, client);
    cancelOrder.register(server, client);
  }

  // MCP Resources
  server.resource(
    "buda-markets",
    "buda://markets",
    async (uri) => {
      const data = await reqCache.getOrFetch<MarketsResponse>(
        "markets",
        CACHE_TTL.MARKETS,
        () => client.get<MarketsResponse>("/markets"),
      );
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(data.markets, null, 2),
          },
        ],
      };
    },
  );

  server.resource(
    "buda-ticker",
    new ResourceTemplate("buda://ticker/{market}", { list: undefined }),
    async (uri, params) => {
      const marketId = (params.market as string).toLowerCase();
      const data = await reqCache.getOrFetch<TickerResponse>(
        `ticker:${marketId}`,
        CACHE_TTL.TICKER,
        () => client.get<TickerResponse>(`/markets/${marketId}/ticker`),
      );
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(data.ticker, null, 2),
          },
        ],
      };
    },
  );

  return server;
}

const app = express();
app.use(express.json());

// Health check for Railway / uptime monitors
app.get("/health", (_req, res) => {
  res.json({ status: "ok", server: "buda-mcp", version: "1.1.2", auth_mode: authEnabled ? "authenticated" : "public" });
});

// Smithery static server card — lets Smithery scan tools without running the server
app.get("/.well-known/mcp/server-card.json", (_req, res) => {
  const publicTools = [
    {
      name: "get_markets",
      description: "List all available trading pairs on Buda.com, or get details for a specific market.",
      inputSchema: {
        type: "object",
        properties: {
          market_id: { type: "string", description: "Optional market ID (e.g. BTC-CLP)" },
        },
      },
    },
    {
      name: "get_ticker",
      description: "Get current price, bid/ask, volume, and price change for a Buda.com market.",
      inputSchema: {
        type: "object",
        properties: {
          market_id: { type: "string", description: "Market ID (e.g. BTC-CLP)" },
        },
        required: ["market_id"],
      },
    },
    {
      name: "get_orderbook",
      description: "Get the full order book (bids and asks) for a Buda.com market.",
      inputSchema: {
        type: "object",
        properties: {
          market_id: { type: "string", description: "Market ID (e.g. BTC-CLP)" },
          limit: { type: "number", description: "Max levels per side" },
        },
        required: ["market_id"],
      },
    },
    {
      name: "get_trades",
      description: "Get recent trade history for a Buda.com market.",
      inputSchema: {
        type: "object",
        properties: {
          market_id: { type: "string", description: "Market ID (e.g. BTC-CLP)" },
          limit: { type: "number", description: "Number of trades (max 100)" },
          timestamp: { type: "number", description: "Unix timestamp for pagination" },
        },
        required: ["market_id"],
      },
    },
    {
      name: "get_market_volume",
      description: "Get 24h and 7-day transacted volume for a Buda.com market.",
      inputSchema: {
        type: "object",
        properties: {
          market_id: { type: "string", description: "Market ID (e.g. BTC-CLP)" },
        },
        required: ["market_id"],
      },
    },
    {
      name: "get_spread",
      description: "Calculate bid/ask spread (absolute and percentage) for a Buda.com market.",
      inputSchema: {
        type: "object",
        properties: {
          market_id: { type: "string", description: "Market ID (e.g. BTC-CLP)" },
        },
        required: ["market_id"],
      },
    },
    {
      name: "compare_markets",
      description: "Compare ticker data for all trading pairs of a given base currency side by side.",
      inputSchema: {
        type: "object",
        properties: {
          base_currency: { type: "string", description: "Base currency (e.g. BTC, ETH)" },
        },
        required: ["base_currency"],
      },
    },
    {
      name: "get_price_history",
      description: "Get OHLCV price history for a market, derived from recent trade history.",
      inputSchema: {
        type: "object",
        properties: {
          market_id: { type: "string", description: "Market ID (e.g. BTC-CLP)" },
          period: { type: "string", enum: ["1h", "4h", "1d"], description: "Candle period" },
          limit: { type: "number", description: "Raw trades to fetch (max 100)" },
        },
        required: ["market_id"],
      },
    },
  ];

  const authTools = authEnabled
    ? [
        {
          name: "get_balances",
          description: "Get all currency balances for the authenticated account.",
          inputSchema: { type: "object", properties: {} },
        },
        {
          name: "get_orders",
          description: "Get orders for a given market.",
          inputSchema: {
            type: "object",
            properties: {
              market_id: { type: "string" },
              state: { type: "string" },
            },
            required: ["market_id"],
          },
        },
        {
          name: "place_order",
          description: "Place a limit or market order. Requires confirmation_token='CONFIRM'.",
          inputSchema: {
            type: "object",
            properties: {
              market_id: { type: "string" },
              type: { type: "string", enum: ["Bid", "Ask"] },
              price_type: { type: "string", enum: ["limit", "market"] },
              amount: { type: "number" },
              limit_price: { type: "number" },
              confirmation_token: { type: "string" },
            },
            required: ["market_id", "type", "price_type", "amount", "confirmation_token"],
          },
        },
        {
          name: "cancel_order",
          description: "Cancel an order by ID. Requires confirmation_token='CONFIRM'.",
          inputSchema: {
            type: "object",
            properties: {
              order_id: { type: "number" },
              confirmation_token: { type: "string" },
            },
            required: ["order_id", "confirmation_token"],
          },
        },
      ]
    : [];

  res.json({
    serverInfo: { name: "buda-mcp", version: "1.1.2" },
    authentication: { required: authEnabled },
    tools: [...publicTools, ...authTools],
    resources: [
      { uri: "buda://markets", name: "All Buda.com markets", mimeType: "application/json" },
      { uri: "buda://ticker/{market}", name: "Ticker for a specific market", mimeType: "application/json" },
    ],
    prompts: [],
  });
});

// Stateless StreamableHTTP — new server instance per request (no session state needed)
app.post("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  res.on("close", () => {
    transport.close();
  });

  const server = createServer();
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// SSE upgrade for clients that prefer streaming
app.get("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  res.on("close", () => {
    transport.close();
  });

  const server = createServer();
  await server.connect(transport);
  await transport.handleRequest(req, res);
});

app.delete("/mcp", async (_req, res) => {
  res.status(405).json({ error: "Sessions not supported (stateless server)" });
});

app.listen(PORT, () => {
  console.log(`buda-mcp HTTP server listening on port ${PORT}`);
  console.log(`  MCP endpoint:  http://localhost:${PORT}/mcp`);
  console.log(`  Health check:  http://localhost:${PORT}/health`);
  console.log(`  Auth mode:     ${authEnabled ? "authenticated" : "public (no credentials)"}`);
});
