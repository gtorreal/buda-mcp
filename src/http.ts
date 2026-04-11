import express from "express";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { BudaClient } from "./client.js";
import { MemoryCache, CACHE_TTL } from "./cache.js";
import { VERSION } from "./version.js";
import type { MarketsResponse, TickerResponse } from "./types.js";
import * as markets from "./tools/markets.js";
import * as ticker from "./tools/ticker.js";
import * as orderbook from "./tools/orderbook.js";
import * as trades from "./tools/trades.js";
import * as volume from "./tools/volume.js";
import * as spread from "./tools/spread.js";
import * as compareMarkets from "./tools/compare_markets.js";
import * as priceHistory from "./tools/price_history.js";
import * as arbitrage from "./tools/arbitrage.js";
import * as marketSummary from "./tools/market_summary.js";
import * as balances from "./tools/balances.js";
import * as orders from "./tools/orders.js";
import * as placeOrder from "./tools/place_order.js";
import * as cancelOrder from "./tools/cancel_order.js";
import { handleMarketSummary } from "./tools/market_summary.js";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

const client = new BudaClient(
  undefined,
  process.env.BUDA_API_KEY,
  process.env.BUDA_API_SECRET,
);

const authEnabled = client.hasAuth();

// Schemas for the Smithery server-card — assembled from the same definitions used in register().
// Adding a new tool only requires exporting its toolSchema; no changes needed here.
const PUBLIC_TOOL_SCHEMAS = [
  markets.toolSchema,
  ticker.toolSchema,
  orderbook.toolSchema,
  trades.toolSchema,
  volume.toolSchema,
  spread.toolSchema,
  compareMarkets.toolSchema,
  priceHistory.toolSchema,
  arbitrage.toolSchema,
  marketSummary.toolSchema,
];

const AUTH_TOOL_SCHEMAS = [
  balances.toolSchema,
  orders.toolSchema,
  placeOrder.toolSchema,
  cancelOrder.toolSchema,
];

function createServer(): McpServer {
  const server = new McpServer({ name: "buda-mcp", version: VERSION });

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
  arbitrage.register(server, client, reqCache);
  marketSummary.register(server, client, reqCache);

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

  server.resource(
    "buda-summary",
    new ResourceTemplate("buda://summary/{market}", { list: undefined }),
    async (uri, params) => {
      const marketId = (params.market as string).toUpperCase();
      const result = await handleMarketSummary({ market_id: marketId }, client, reqCache);
      const text = result.content[0].text;
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text,
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
  res.json({
    status: "ok",
    server: "buda-mcp",
    version: VERSION,
    auth_mode: authEnabled ? "authenticated" : "public",
  });
});

// Smithery static server card — assembled programmatically from tool definitions.
// Adding a new tool only requires exporting its toolSchema; this handler needs no changes.
app.get("/.well-known/mcp/server-card.json", (_req, res) => {
  res.json({
    serverInfo: { name: "buda-mcp", version: VERSION },
    authentication: { required: authEnabled },
    tools: [...PUBLIC_TOOL_SCHEMAS, ...(authEnabled ? AUTH_TOOL_SCHEMAS : [])],
    resources: [
      { uri: "buda://markets", name: "All Buda.com markets", mimeType: "application/json" },
      { uri: "buda://ticker/{market}", name: "Ticker for a specific market", mimeType: "application/json" },
      { uri: "buda://summary/{market}", name: "Full market summary with liquidity rating", mimeType: "application/json" },
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
