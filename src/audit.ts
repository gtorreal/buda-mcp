/**
 * Structured audit logging for destructive MCP tool calls.
 *
 * Writes newline-delimited JSON to stderr so it never pollutes the stdio MCP transport
 * and is captured by Railway / any log aggregator attached to the process.
 *
 * Rules for args_summary:
 *   - Include: market_id, currency, price_type, type, amount ranges
 *   - NEVER include: confirmation_token, invoice, address, bank_account_id
 *
 * IP is auto-populated from the AsyncLocalStorage request context when running
 * in HTTP mode — no changes to call sites required.
 */

import { requestContext } from "./request-context.js";

export interface AuditEvent {
  ts: string;
  tool: string;
  transport: "http" | "stdio";
  ip?: string;
  args_summary: Record<string, unknown>;
  success: boolean;
  error_code?: string | number;
}

export function logAudit(event: AuditEvent): void {
  const ctx = requestContext.getStore();
  const enriched = ctx?.ip ? { ...event, ip: ctx.ip } : event;
  process.stderr.write(JSON.stringify({ audit: true, ...enriched }) + "\n");
}
