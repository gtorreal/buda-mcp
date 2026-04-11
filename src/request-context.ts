import { AsyncLocalStorage } from "async_hooks";

export interface RequestContext {
  ip?: string;
}

/**
 * AsyncLocalStorage context propagated through the lifetime of each HTTP
 * request. Tool handlers call logAudit() without knowing the HTTP layer;
 * audit.ts reads this store automatically so IP is included in every
 * audit event for HTTP requests without threading it through every handler.
 */
export const requestContext = new AsyncLocalStorage<RequestContext>();
