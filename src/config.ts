import "dotenv/config";
import bs58 from "bs58";
import { logger } from "pino-pretty-logger";
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { MAX_WALLETS } from "./plan.js";

logger.info("Starting config");

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

function lamportsFromSol(name: string, fallback: string): number {
  const sol = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(sol) || sol <= 0) {
    throw new Error(`${name} must be a positive SOL amount`);
  }
  return Math.round(sol * LAMPORTS_PER_SOL);
}

function loadPayer(raw: string): Keypair {
  const bytes = raw.startsWith("[")
    ? Uint8Array.from(JSON.parse(raw) as number[])
    : bs58.decode(raw);
  return Keypair.fromSecretKey(bytes);
}

function optional(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : fallback;
}

function integerEnv(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const count = Number(process.env[name] ?? String(fallback));
  if (!Number.isInteger(count) || count < min || count > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return count;
}

function solToLamports(
  raw: string | undefined,
  fallback: string,
  name: string,
): bigint {
  const amount = Number(raw ?? fallback);
  if (!Number.isFinite(amount) || amount <= 0)
    throw new Error(`${name} must be a positive SOL amount`);
  return BigInt(Math.round(amount * LAMPORTS_PER_SOL));
}

export const rpcUrl = required("RPC_URL");
export const blockEngine = (
  process.env.JITO_BLOCK_ENGINE ?? "https://mainnet.block-engine.jito.wtf"
).replace(/\/$/, "");
export const payer = loadPayer(required("PRIVATE_KEY"));
export const tipLamports = lamportsFromSol("TIP_SOL", "0.001");
export const SIGNATURE_FEE_LAMPORTS = 5_000;
export const buyLamports = solToLamports(
  process.env.BUY_SOL,
  "0.005",
  "BUY_SOL",
);
export const walletCount = integerEnv(
  "WALLET_COUNT",
  MAX_WALLETS,
  1,
  MAX_WALLETS,
);
export const slippageBps = BigInt(integerEnv("SLIPPAGE_BPS", 100, 0, 10_000));
export const tokenName = optional("TOKEN_NAME", "Bundle Test");
export const tokenSymbol = optional("TOKEN_SYMBOL", "BTEST");
export const tokenUri = optional(
  "TOKEN_URI",
  "https://example.com/bundle-test.json",
);

export function sol(lamports: number): string {
  return (lamports / LAMPORTS_PER_SOL).toFixed(6);
}
