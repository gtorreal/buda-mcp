import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { BudaClient } from "./client.js";
import * as markets from "./tools/markets.js";
import * as ticker from "./tools/ticker.js";
import * as orderbook from "./tools/orderbook.js";
import * as trades from "./tools/trades.js";
import * as volume from "./tools/volume.js";

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const client = new BudaClient();

function createServer(): McpServer {
  const server = new McpServer({ name: "buda-mcp", version: "1.0.0" });
  markets.register(server, client);
  ticker.register(server, client);
  orderbook.register(server, client);
  trades.register(server, client);
  volume.register(server, client);
  return server;
}

const app = express();
app.use(express.json());

// Health check for Railway / uptime monitors
app.get("/health", (_req, res) => {
  res.json({ status: "ok", server: "buda-mcp", version: "1.0.0" });
});

// Smithery static server card — lets Smithery scan tools without running the server
app.get("/.well-known/mcp/server-card.json", (_req, res) => {
  res.json({
    serverInfo: { name: "buda-mcp", version: "1.0.0" },
    authentication: { required: false },
    tools: [
      {
        name: "get_markets",
        description:
          "List all available trading pairs on Buda.com, or get details for a specific market.",
        inputSchema: {
          type: "object",
          properties: {
            market_id: { type: "string", description: "Optional market ID (e.g. BTC-CLP)" },
          },
        },
      },
      {
        name: "get_ticker",
        description:
          "Get current price, bid/ask, volume, and price change for a Buda.com market.",
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
    ],
    resources: [],
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

app.delete("/mcp", async (req, res) => {
  res.status(405).json({ error: "Sessions not supported (stateless server)" });
});

app.listen(PORT, () => {
  console.log(`buda-mcp HTTP server listening on port ${PORT}`);
  console.log(`  MCP endpoint:  http://localhost:${PORT}/mcp`);
  console.log(`  Health check:  http://localhost:${PORT}/health`);
});
