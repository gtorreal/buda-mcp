import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BudaClient, BudaApiError } from "../client.js";
import { flattenAmount } from "../utils.js";
import { logAudit } from "../audit.js";
import type { LightningWithdrawalResponse, LightningInvoiceResponse } from "../types.js";

export const lightningWithdrawalToolSchema = {
  name: "lightning_withdrawal",
  description:
    "Pay a Bitcoin Lightning Network invoice from your Buda.com LN-BTC reserve. " +
    "IMPORTANT: Funds leave the account immediately on success. " +
    "Pass confirmation_token='CONFIRM' to execute. " +
    "Requires BUDA_API_KEY and BUDA_API_SECRET.",
  inputSchema: {
    type: "object" as const,
    properties: {
      invoice: {
        type: "string",
        description: "BOLT-11 Lightning invoice string (starts with 'lnbc', 'lntb', etc.).",
      },
      confirmation_token: {
        type: "string",
        description:
          "Safety confirmation. Must equal exactly 'CONFIRM' (case-sensitive) to execute. " +
          "Any other value will reject the request without paying.",
      },
    },
    required: ["invoice", "confirmation_token"],
  },
};

export const createLightningInvoiceToolSchema = {
  name: "create_lightning_invoice",
  description:
    "Create a Bitcoin Lightning Network invoice on Buda.com to receive a payment. " +
    "No funds leave the account — no confirmation required. " +
    "Requires BUDA_API_KEY and BUDA_API_SECRET.",
  inputSchema: {
    type: "object" as const,
    properties: {
      amount_satoshis: {
        type: "number",
        description: "Invoice amount in satoshis (positive integer).",
      },
      description: {
        type: "string",
        description: "Optional payment description (max 140 characters).",
      },
      expiry_seconds: {
        type: "number",
        description: "Invoice expiry in seconds (60–86400, default: 3600).",
      },
    },
    required: ["amount_satoshis"],
  },
};

type LightningWithdrawalArgs = {
  invoice: string;
  confirmation_token: string;
};

type CreateLightningInvoiceArgs = {
  amount_satoshis: number;
  description?: string;
  expiry_seconds?: number;
};

export async function handleLightningWithdrawal(
  args: LightningWithdrawalArgs,
  client: BudaClient,
  transport: "http" | "stdio" = "stdio",
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const { invoice, confirmation_token } = args;

  if (confirmation_token !== "CONFIRM") {
    const preview = invoice.length > 20 ? invoice.substring(0, 20) + "..." : invoice;
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error:
              "Lightning withdrawal not executed. confirmation_token must equal 'CONFIRM' to execute. " +
              "Review the invoice and set confirmation_token='CONFIRM' to proceed.",
            code: "CONFIRMATION_REQUIRED",
            preview: { invoice_preview: preview },
          }),
        },
      ],
      isError: true,
    };
  }

  const BOLT11_RE = /^ln(bc|tb|bcrt)\d*[munp]?1[a-z0-9]{20,}$/i;
  if (!BOLT11_RE.test(invoice)) {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          error:
            "Invalid Lightning invoice format. " +
            "Expected a BOLT-11 string starting with 'lnbc', 'lntb', or 'lnbcrt'.",
          code: "INVALID_INVOICE",
        }),
      }],
      isError: true,
    };
  }

  try {
    const data = await client.post<LightningWithdrawalResponse>(
      `/reserves/ln-btc/withdrawals`,
      { invoice },
    );

    const lw = data.lightning_withdrawal;
    const amount = flattenAmount(lw.amount);
    const fee = flattenAmount(lw.fee);

    const result = {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              id: lw.id,
              state: lw.state,
              amount: amount.value,
              amount_currency: amount.currency,
              fee: fee.value,
              fee_currency: fee.currency,
              payment_hash: lw.payment_hash,
              created_at: lw.created_at,
            },
            null,
            2,
          ),
        },
      ],
    };
    logAudit({
      ts: new Date().toISOString(),
      tool: "lightning_withdrawal",
      transport,
      args_summary: { amount_btc: amount.value },
      success: true,
    });
    return result;
  } catch (err) {
    const msg =
      err instanceof BudaApiError
        ? { error: err.message, code: err.status }
        : { error: String(err), code: "UNKNOWN" };
    const result = { content: [{ type: "text" as const, text: JSON.stringify(msg) }], isError: true as const };
    logAudit({ ts: new Date().toISOString(), tool: "lightning_withdrawal", transport, args_summary: {}, success: false, error_code: msg.code as string | number });
    return result;
  }
}

export async function handleCreateLightningInvoice(
  args: CreateLightningInvoiceArgs,
  client: BudaClient,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const { amount_satoshis, description, expiry_seconds } = args;

  try {
    const invoicePayload: Record<string, unknown> = { amount: amount_satoshis };
    if (description !== undefined) invoicePayload.description = description;
    if (expiry_seconds !== undefined) invoicePayload.expiry = expiry_seconds;

    const data = await client.post<LightningInvoiceResponse>(
      `/lightning_network_invoices`,
      { lightning_network_invoice: invoicePayload },
    );

    const inv = data.lightning_network_invoice;
    const amount = flattenAmount(inv.amount);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              id: inv.id,
              payment_request: inv.payment_request,
              amount_satoshis: amount.value,
              description: inv.description,
              expires_at: inv.expires_at,
              state: inv.state,
              created_at: inv.created_at,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (err) {
    const msg =
      err instanceof BudaApiError
        ? { error: err.message, code: err.status }
        : { error: String(err), code: "UNKNOWN" };
    return {
      content: [{ type: "text", text: JSON.stringify(msg) }],
      isError: true,
    };
  }
}

export function register(
  server: McpServer,
  client: BudaClient,
  transport: "http" | "stdio" = "stdio",
): void {
  server.tool(
    lightningWithdrawalToolSchema.name,
    lightningWithdrawalToolSchema.description,
    {
      invoice: z
        .string()
        .min(50)
        .describe("BOLT-11 Lightning invoice string (starts with 'lnbc', 'lntb', etc.)."),
      confirmation_token: z
        .string()
        .describe(
          "Safety confirmation. Must equal exactly 'CONFIRM' (case-sensitive) to execute. " +
            "Any other value will reject the request without paying.",
        ),
    },
    (args) => handleLightningWithdrawal(args, client, transport),
  );

  server.tool(
    createLightningInvoiceToolSchema.name,
    createLightningInvoiceToolSchema.description,
    {
      amount_satoshis: z
        .number()
        .int()
        .positive()
        .describe("Invoice amount in satoshis (positive integer)."),
      description: z
        .string()
        .max(140)
        .optional()
        .describe("Optional payment description (max 140 characters)."),
      expiry_seconds: z
        .number()
        .int()
        .min(60)
        .max(86400)
        .optional()
        .describe("Invoice expiry in seconds (60–86400, default: 3600)."),
    },
    (args) => handleCreateLightningInvoice(args, client),
  );
}
