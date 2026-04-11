import { createHmac } from "crypto";
import { VERSION } from "./version.js";

const BASE_URL = "https://www.buda.com/api/v2";

export class BudaApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    message: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "BudaApiError";
  }
}

export class BudaClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly apiSecret: string | undefined;

  constructor(
    baseUrl: string = BASE_URL,
    apiKey?: string,
    apiSecret?: string,
  ) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
  }

  hasAuth(): boolean {
    return Boolean(this.apiKey && this.apiSecret);
  }

  private _nonceCounter = 0;

  private nonce(): string {
    return String(Date.now() * 1000 + (this._nonceCounter++ % 1000));
  }

  private sign(method: string, pathWithQuery: string, body: string, nonce: string): string {
    const encodedBody = body ? Buffer.from(body).toString("base64") : "";
    const parts = [method, pathWithQuery];
    if (encodedBody) parts.push(encodedBody);
    parts.push(nonce);
    const msg = parts.join(" ");
    return createHmac("sha384", this.apiSecret!).update(msg).digest("hex");
  }

  private authHeaders(method: string, path: string, body?: string): Record<string, string> {
    if (!this.hasAuth()) return {};
    const nonce = this.nonce();
    const signature = this.sign(method, path, body ?? "", nonce);
    return {
      "X-SBTC-APIKEY": this.apiKey!,
      "X-SBTC-NONCE": nonce,
      "X-SBTC-SIGNATURE": signature,
    };
  }

  /**
   * Parses the Retry-After header value into milliseconds.
   * Per RFC 7231, Retry-After is an integer number of seconds.
   * Defaults to 1000ms (1 second) if absent or unparseable.
   */
  private parseRetryAfterMs(headers: Headers): number {
    const raw = headers.get("Retry-After");
    if (!raw) return 1000;
    const secs = parseInt(raw, 10);
    return isNaN(secs) ? 1000 : secs * 1000;
  }

  /**
   * Executes a fetch call with a single 429 retry.
   * On the first 429, waits for Retry-After seconds (default 1s), then retries once.
   * If the retry also returns 429, throws a BudaApiError with retryAfterMs set.
   */
  private async fetchWithRetry(
    url: URL,
    options: RequestInit,
    path: string,
  ): Promise<Response> {
    const response = await fetch(url.toString(), {
      ...options,
      signal: AbortSignal.timeout(15_000),
    });

    if (response.status !== 429) return response;

    const retryAfterMs = this.parseRetryAfterMs(response.headers);
    await new Promise((r) => setTimeout(r, retryAfterMs));

    const retry = await fetch(url.toString(), {
      ...options,
      signal: AbortSignal.timeout(15_000),
    });

    if (retry.status === 429) {
      const retryAgainMs = this.parseRetryAfterMs(retry.headers);
      throw new BudaApiError(
        429,
        path,
        `Buda API rate limit exceeded. Retry after ${retryAgainMs}ms.`,
        retryAgainMs,
      );
    }

    return retry;
  }

  private async handleResponse<T>(response: Response, path: string): Promise<T> {
    if (!response.ok) {
      let detail = response.statusText;
      try {
        const body = (await response.json()) as { message?: string };
        if (body.message) detail = body.message;
      } catch {
        // ignore parse error, use statusText
      }
      // Log full upstream detail server-side only — never forward to MCP caller
      process.stderr.write(
        JSON.stringify({ buda_api_error: true, status: response.status, path, detail }) + "\n",
      );
      const clientMsg =
        response.status === 429
          ? `Rate limit exceeded on ${path}. Retry later.`
          : `Buda API error ${response.status} on ${path}.`;
      throw new BudaApiError(response.status, path, clientMsg);
    }
    return response.json() as Promise<T>;
  }

  async get<T>(path: string, params?: Record<string, string | number>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}.json`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, String(value));
      }
    }

    const urlPath = url.pathname + url.search;
    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": `buda-mcp/${VERSION}`,
      ...this.authHeaders("GET", urlPath),
    };

    const response = await this.fetchWithRetry(url, { headers }, path);
    return this.handleResponse<T>(response, path);
  }

  async post<T>(path: string, payload: unknown): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}.json`);
    const bodyStr = JSON.stringify(payload);
    const urlPath = url.pathname + url.search;
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": `buda-mcp/${VERSION}`,
      ...this.authHeaders("POST", urlPath, bodyStr),
    };

    const response = await this.fetchWithRetry(
      url,
      { method: "POST", headers, body: bodyStr },
      path,
    );
    return this.handleResponse<T>(response, path);
  }

  async put<T>(path: string, payload: unknown): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}.json`);
    const bodyStr = JSON.stringify(payload);
    const urlPath = url.pathname + url.search;
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": `buda-mcp/${VERSION}`,
      ...this.authHeaders("PUT", urlPath, bodyStr),
    };

    const response = await this.fetchWithRetry(
      url,
      { method: "PUT", headers, body: bodyStr },
      path,
    );
    return this.handleResponse<T>(response, path);
  }

  async delete<T>(path: string, params?: Record<string, string | number>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}.json`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, String(value));
      }
    }

    const urlPath = url.pathname + url.search;
    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": `buda-mcp/${VERSION}`,
      ...this.authHeaders("DELETE", urlPath),
    };

    const response = await this.fetchWithRetry(url, { method: "DELETE", headers }, path);
    return this.handleResponse<T>(response, path);
  }
}
