import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { BudaClient } from "./client.js";
import { MemoryCache, CACHE_TTL } from "./cache.js";
import { parseEnvInt } from "./utils.js";
import { requestContext } from "./request-context.js";
import { VERSION } from "./version.js";
import { validateMarketId } from "./validation.js";
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
import * as simulateOrder from "./tools/simulate_order.js";
import * as positionSize from "./tools/calculate_position_size.js";
import * as marketSentiment from "./tools/market_sentiment.js";
import * as technicalIndicators from "./tools/technical_indicators.js";
import * as banks from "./tools/banks.js";
import * as quotation from "./tools/quotation.js";
import { handleMarketSummary } from "./tools/market_summary.js";

let PORT: number;
try {
  PORT = parseEnvInt(process.env.PORT, 3000, 1, 65535, "PORT");
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

let TRUST_PROXY_HOPS: number;
try {
  // trust proxy: number of reverse-proxy hops to trust for X-Forwarded-For.
  // Default 1 = one hop (Railway). Add 1 per additional proxy layer in front (e.g. Cloudflare).
  // Wrong value allows clients to spoof X-Forwarded-For and bypass IP-based rate limiting.
  TRUST_PROXY_HOPS = parseEnvInt(process.env.TRUST_PROXY_HOPS, 1, 0, 10, "TRUST_PROXY_HOPS");
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

const client = new BudaClient();

// Schemas for the Smithery server-card — assembled from the same definitions used in register().
// Adding a new tool only requires exporting its toolSchema; no changes needed here.
const TOOL_SCHEMAS = [
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
  simulateOrder.toolSchema,
  quotation.toolSchema,
  positionSize.toolSchema,
  marketSentiment.toolSchema,
  technicalIndicators.toolSchema,
  banks.toolSchema,
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
  simulateOrder.register(server, client, reqCache);
  quotation.register(server, client);
  positionSize.register(server);
  marketSentiment.register(server, client, reqCache);
  technicalIndicators.register(server, client);
  banks.register(server, client, reqCache);

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
      const raw = params.market as string;
      const validationError = validateMarketId(raw);
      if (validationError) throw new Error(validationError);
      const marketId = raw.toLowerCase();
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
      const raw = params.market as string;
      const validationError = validateMarketId(raw);
      if (validationError) throw new Error(validationError);
      const marketId = raw.toUpperCase();
      const result = await handleMarketSummary({ market_id: marketId }, client, reqCache);
      const text = result.content[0]?.text ?? JSON.stringify({ error: "No content returned" });
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
app.use(helmet());
// CORS: intentionally not configured. This server is designed for server-to-server MCP
// communication only (AI agents, Claude Desktop, etc.) — not for browser clients.
// Helmet already sets X-Content-Type-Options, X-Frame-Options, and related headers.
// trust proxy: configured via TRUST_PROXY_HOPS env var (default: 1 = Railway's single hop).
// Increment by 1 for each additional reverse-proxy layer (e.g. set to 2 when Cloudflare + Railway).
// Wrong value allows clients to spoof X-Forwarded-For and bypass IP-based rate limiting.
// Affects: req.ip and express-rate-limit client IP detection.
app.set("trust proxy", TRUST_PROXY_HOPS);
app.use(express.json({ limit: "10kb" }));

let rateLimitMax: number;
try {
  rateLimitMax = parseEnvInt(process.env.MCP_RATE_LIMIT, 120, 1, 10_000, "MCP_RATE_LIMIT");
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

const mcpRateLimiter = rateLimit({
  windowMs: 60_000,
  max: rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Retry after 60 seconds.", code: "RATE_LIMITED" },
});

const staticRateLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests.", code: "RATE_LIMITED" },
});

// Health check for Railway / uptime monitors.
// version is intentionally omitted to avoid fingerprinting by unauthenticated callers.
app.get("/health", staticRateLimiter, (_req, res) => {
  res.json({ status: "ok" });
});

// Smithery static server card — assembled programmatically from tool definitions.
// Adding a new tool only requires exporting its toolSchema; this handler needs no changes.
app.get("/.well-known/mcp/server-card.json", staticRateLimiter, (_req, res) => {
  res.json({
    serverInfo: { name: "buda-mcp", version: VERSION },
    authentication: { required: false },
    tools: TOOL_SCHEMAS,
    resources: [
      { uri: "buda://markets", name: "All Buda.com markets", mimeType: "application/json" },
      { uri: "buda://ticker/{market}", name: "Ticker for a specific market", mimeType: "application/json" },
      { uri: "buda://summary/{market}", name: "Full market summary with liquidity rating", mimeType: "application/json" },
    ],
    prompts: [],
  });
});

// Stateless StreamableHTTP — new server instance per request (no session state needed)
app.post("/mcp", mcpRateLimiter, async (req, res) => {
  await requestContext.run({ ip: req.ip }, async () => {
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
});

// SSE upgrade for clients that prefer streaming
app.get("/mcp", mcpRateLimiter, async (req, res) => {
  await requestContext.run({ ip: req.ip }, async () => {
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
});

app.delete("/mcp", mcpRateLimiter, async (_req, res) => {
  res.status(405).json({ error: "Sessions not supported (stateless server)" });
});

app.listen(PORT, () => {
  console.log(`buda-mcp HTTP server listening on port ${PORT}`);
  console.log(`  MCP endpoint:  http://localhost:${PORT}/mcp`);
  console.log(`  Health check:  http://localhost:${PORT}/health`);
});
