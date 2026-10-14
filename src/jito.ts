import { blockEngine } from "./config.js";

const REGIONS = [
  blockEngine,
  "https://tokyo.mainnet.block-engine.jito.wtf",
  "https://ny.mainnet.block-engine.jito.wtf",
  "https://frankfurt.mainnet.block-engine.jito.wtf",
  "https://amsterdam.mainnet.block-engine.jito.wtf",
  "https://slc.mainnet.block-engine.jito.wtf",
];

export class JitoRequestError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

function unique(urls: string[]): string[] {
  return [...new Set(urls.map((url) => url.replace(/\/$/, "")))];
}

export async function jitoCall(
  path: string,
  method: string,
  params: unknown[],
  { failover = false }: { failover?: boolean } = {},
): Promise<{ result: unknown; endpoint: string }> {
  const bases = failover ? unique(REGIONS) : [blockEngine];
  let lastError: unknown;

  for (const base of bases) {
    const url = `${base}${path}`;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      const text = await response.text();
      let body: { result?: unknown; error?: { message?: string } };
      try {
        body = JSON.parse(text) as { result?: unknown; error?: { message?: string } };
      } catch {
        throw new JitoRequestError(`non-json HTTP ${response.status}: ${text.slice(0, 300)}`, response.status);
      }
      if (!response.ok || body.error) {
        const message = body.error?.message ?? text.slice(0, 300);
        throw new JitoRequestError(`${method} ${response.status}: ${message}`, response.status);
      }
      return { result: body.result, endpoint: base };
    } catch (error) {
      lastError = error;
      const status = error instanceof JitoRequestError ? error.status : undefined;
      const retryable = status === 429 || (status !== undefined && status >= 500) || status === undefined;
      if (!failover || !retryable) throw error;
    }
  }

  throw lastError;
}
