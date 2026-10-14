export type Simulation = {
  err: unknown;
  unitsConsumed: number | null;
  logs?: string[];
  innerInstructions?: { instructions: unknown[] }[];
};

export async function rpc<T>(url: string, method: string, params?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await response.json()) as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result as T;
}

export async function simulate(url: string, wire: string): Promise<Simulation> {
  const result = await rpc<{ value: Simulation }>(url, "simulateTransaction", [
    wire,
    { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, innerInstructions: true },
  ]);
  return result.value;
}

export function traceOf(simulation: Simulation, topLevel: number): number {
  const inner = (simulation.innerInstructions ?? []).reduce((sum, group) => sum + group.instructions.length, 0);
  return topLevel + inner;
}

export async function sendTransaction(url: string, wire: string): Promise<string> {
  return rpc<string>(url, "sendTransaction", [wire, { encoding: "base64", skipPreflight: true }]);
}

export async function waitForSignature(url: string, signature: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await rpc<{ value: ({ err: unknown; confirmationStatus?: string } | null)[] }>(url, "getSignatureStatuses", [
      [signature],
    ]);
    const value = status.value[0];
    if (value?.err) throw new Error(`${signature} failed: ${JSON.stringify(value.err)}`);
    if (value?.confirmationStatus === "confirmed" || value?.confirmationStatus === "finalized") return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`timed out waiting for ${signature}`);
}

export async function balance(url: string, account: string): Promise<number> {
  const result = await rpc<number | { value: number }>(url, "getBalance", [account, { commitment: "confirmed" }]);
  return typeof result === "number" ? result : result.value;
}

export function simulationLine(label: string, simulation: Simulation, bytes?: number, instructions?: number): string {
  const status = simulation.err ? JSON.stringify(simulation.err) : "ok";
  const size = bytes === undefined ? "" : `  bytes=${bytes}`;
  const count = instructions === undefined ? "" : `  instructions=${instructions}`;
  return `${label}: ${status}  cu=${simulation.unitsConsumed}${size}${count}`;
}
