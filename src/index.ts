import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BudaClient } from "./client.js";
import * as markets from "./tools/markets.js";
import * as ticker from "./tools/ticker.js";
import * as orderbook from "./tools/orderbook.js";
import * as trades from "./tools/trades.js";
import * as volume from "./tools/volume.js";

const server = new McpServer({
  name: "buda-mcp",
  version: "1.0.0",
});

const client = new BudaClient();

// Register all public-endpoint tools
markets.register(server, client);
ticker.register(server, client);
orderbook.register(server, client);
trades.register(server, client);
volume.register(server, client);

// Start the server over stdio (standard MCP transport)
const transport = new StdioServerTransport();
await server.connect(transport);
