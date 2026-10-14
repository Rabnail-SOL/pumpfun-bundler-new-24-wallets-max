import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  createTransactionMessage,
  getAddressEncoder,
  getBase64EncodedWireTransaction,
  getProgramDerivedAddress,
  pipe,
  setTransactionMessageComputeUnitLimit,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  setTransactionMessageLoadedAccountsDataSizeLimit,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import { getSignatureFromTransaction } from "@solana/transactions";

export const PUMP = address("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
export const ATA_PROGRAM = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const TOKEN_2022 = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
export const TOKEN = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const WSOL = address("So11111111111111111111111111111111111111112");
export const SYSTEM = address("11111111111111111111111111111111");
const FEE_CONFIG = address("8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt");
const BUYBACK = address("5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD");
const BUY_EXACT_V3 = Uint8Array.from([225, 247, 80, 30, 213, 179, 132, 136]);
const FEE_DENOMINATOR = 10_000n;
export const VOLUME_ACCOUNT_RENT = 1_844_400n;
const SELL_V3 = Uint8Array.from([28, 146, 222, 119, 38, 196, 105, 213]);
const CLOSE_VOLUME = Uint8Array.from([249, 69, 164, 218, 150, 103, 84, 138]);

const encoder = getAddressEncoder();

type RpcResult<T> = T;

async function rpc<T>(url: string, method: string, params?: unknown): Promise<RpcResult<T>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await response.json()) as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result as T;
}

function u64(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return bytes;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function pda(programAddress: Address, seeds: (string | Uint8Array)[]): Promise<Address> {
  const [derived] = await getProgramDerivedAddress({ programAddress, seeds });
  return derived;
}

function bytes(value: { length: number; [index: number]: number }): Uint8Array {
  return Uint8Array.from(value);
}

async function tokenAccount(owner: Address, mint: Address, tokenProgram: Address): Promise<Address> {
  return pda(ATA_PROGRAM, [bytes(encoder.encode(owner)), bytes(encoder.encode(tokenProgram)), bytes(encoder.encode(mint))]);
}

const MAYHEM = address("MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e");
const CREATE_V2 = Uint8Array.from([214, 144, 76, 236, 95, 139, 49, 180]);

function borshString(value: string): Uint8Array {
  const raw = new TextEncoder().encode(value);
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, raw.length, true);
  return concat([length, raw]);
}

export function transferInstruction(from: TransactionSigner, to: Address, lamports: bigint): Instruction {
  const data = new Uint8Array(12);
  new DataView(data.buffer).setUint32(0, 2, true);
  new DataView(data.buffer).setBigUint64(4, lamports, true);
  return {
    programAddress: SYSTEM,
    accounts: [
      { address: from.address, role: AccountRole.WRITABLE_SIGNER, signer: from },
      { address: to, role: AccountRole.WRITABLE },
    ] as Instruction["accounts"],
    data,
  };
}

export async function createV2Instruction(
  user: TransactionSigner,
  mint: TransactionSigner,
  name: string,
  symbol: string,
  uri: string,
): Promise<Instruction> {
  const mintAuthority = await pda(PUMP, ["mint-authority"]);
  const bondingCurve = await pda(PUMP, ["bonding-curve", bytes(encoder.encode(mint.address))]);
  const associatedBondingCurve = await tokenAccount(bondingCurve, mint.address, TOKEN_2022);
  const global = await pda(PUMP, ["global"]);
  const solVault = await pda(MAYHEM, ["sol-vault"]);
  const mayhemTokenVault = await tokenAccount(solVault, mint.address, TOKEN_2022);
  return {
    programAddress: PUMP,
    accounts: [
      { address: mint.address, role: AccountRole.WRITABLE_SIGNER, signer: mint },
      { address: mintAuthority, role: AccountRole.READONLY },
      { address: bondingCurve, role: AccountRole.WRITABLE },
      { address: associatedBondingCurve, role: AccountRole.WRITABLE },
      { address: global, role: AccountRole.READONLY },
      { address: user.address, role: AccountRole.WRITABLE_SIGNER, signer: user },
      { address: SYSTEM, role: AccountRole.READONLY },
      { address: TOKEN_2022, role: AccountRole.READONLY },
      { address: ATA_PROGRAM, role: AccountRole.READONLY },
      { address: MAYHEM, role: AccountRole.WRITABLE },
      { address: await pda(MAYHEM, ["global-params"]), role: AccountRole.READONLY },
      { address: solVault, role: AccountRole.WRITABLE },
      { address: await pda(MAYHEM, ["mayhem-state", bytes(encoder.encode(mint.address))]), role: AccountRole.WRITABLE },
      { address: mayhemTokenVault, role: AccountRole.WRITABLE },
      { address: await pda(PUMP, ["__event_authority"]), role: AccountRole.READONLY },
      { address: PUMP, role: AccountRole.READONLY },
    ] as Instruction["accounts"],
    data: concat([
      CREATE_V2,
      borshString(name),
      borshString(symbol),
      borshString(uri),
      bytes(encoder.encode(user.address)),
      Uint8Array.of(0),
    ]),
  };
}

async function createBaseAtaInstruction(mint: Address, payer: TransactionSigner, buyer: TransactionSigner): Promise<Instruction> {
  return {
    programAddress: ATA_PROGRAM,
    accounts: [
      { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
      { address: await tokenAccount(buyer.address, mint, TOKEN_2022), role: AccountRole.WRITABLE },
      { address: buyer.address, role: AccountRole.READONLY },
      { address: mint, role: AccountRole.READONLY },
      { address: SYSTEM, role: AccountRole.READONLY },
      { address: TOKEN_2022, role: AccountRole.READONLY },
    ] as Instruction["accounts"],
    data: Uint8Array.of(1),
  };
}

export type CurveState = {
  virtualTokenReserves: bigint;
  virtualQuoteReserves: bigint;
  tokenTotalSupply: bigint;
  protocolFeeBps: bigint;
  creatorFeeBps: bigint;
  tiers: { threshold: bigint; protocolFeeBps: bigint; creatorFeeBps: bigint }[];
};

function feesFor(state: CurveState): { protocolFeeBps: bigint; creatorFeeBps: bigint } {
  const marketCap = (state.virtualQuoteReserves * state.tokenTotalSupply) / state.virtualTokenReserves;
  const tiers = [...state.tiers].sort((left, right) => (left.threshold < right.threshold ? -1 : 1));
  if (tiers.length === 0) return { protocolFeeBps: state.protocolFeeBps, creatorFeeBps: state.creatorFeeBps };
  if (marketCap < tiers[0].threshold) return tiers[0];
  for (const tier of [...tiers].reverse()) {
    if (marketCap >= tier.threshold) return tier;
  }
  return tiers[0];
}

export function quoteExactQuoteIn(state: CurveState, quoteIn: bigint): { tokensOut: bigint; next: CurveState } {
  const fees = feesFor(state);
  const totalFeeBps = fees.protocolFeeBps + fees.creatorFeeBps;
  // Same integer path as the Pump SDK, then one lamport less in the constant product.
  // The curve still receives the SDK net. That pair matches buy_exact_quote_in_v3 fills.
  const netQuote = ((quoteIn - 1n) * FEE_DENOMINATOR) / (FEE_DENOMINATOR + totalFeeBps);
  const swapQuote = netQuote - 1n;
  if (swapQuote <= 0n) throw new Error("SOL amount does not cover the trading fee");
  const tokensOut = (state.virtualTokenReserves * swapQuote) / (state.virtualQuoteReserves + swapQuote);
  if (tokensOut <= 0n) throw new Error("quote returned zero tokens");
  return {
    tokensOut,
    next: {
      ...state,
      virtualTokenReserves: state.virtualTokenReserves - tokensOut,
      virtualQuoteReserves: state.virtualQuoteReserves + netQuote,
    },
  };
}

export async function loadFreshCurve(rpcUrl: string): Promise<CurveState> {
  const global = await pda(PUMP, ["global"]);
  const globalInfo = await rpc<{ value: { data: [string, string] } | null }>(rpcUrl, "getAccountInfo", [
    global,
    { encoding: "base64" },
  ]);
  if (!globalInfo.value) throw new Error("Pump global account is missing");
  const data = Buffer.from(globalInfo.value.data[0], "base64");
  let offset = 8 + 1 + 32 + 32;
  const virtualTokenReserves = data.readBigUInt64LE(offset);
  offset += 8;
  const virtualQuoteReserves = data.readBigUInt64LE(offset);
  offset += 16;
  const tokenTotalSupply = data.readBigUInt64LE(offset);
  offset += 8;
  const protocolFeeBps = data.readBigUInt64LE(offset);

  const feeInfo = await rpc<{ value: { data: [string, string] } | null }>(rpcUrl, "getAccountInfo", [
    FEE_CONFIG.toString(),
    { encoding: "base64" },
  ]);
  const tiers: CurveState["tiers"] = [];
  let creatorFeeBps = 30n;
  if (feeInfo.value) {
    const fees = Buffer.from(feeInfo.value.data[0], "base64");
    let cursor = 8 + 1 + 32;
    creatorFeeBps = fees.readBigUInt64LE(cursor + 16);
    cursor += 24;
    const count = fees.readUInt32LE(cursor);
    cursor += 4;
    for (let index = 0; index < count && cursor + 40 <= fees.length; index += 1) {
      const threshold = fees.readBigUInt64LE(cursor) + (fees.readBigUInt64LE(cursor + 8) << 64n);
      cursor += 16;
      tiers.push({
        threshold,
        protocolFeeBps: fees.readBigUInt64LE(cursor + 8),
        creatorFeeBps: fees.readBigUInt64LE(cursor + 16),
      });
      cursor += 24;
    }
  }

  return { virtualTokenReserves, virtualQuoteReserves, tokenTotalSupply, protocolFeeBps, creatorFeeBps, tiers };
}

export async function exactQuoteBuyInstructions(
  mint: Address,
  payer: TransactionSigner,
  buyer: TransactionSigner,
  quoteIn: bigint,
  minTokensOut: bigint,
): Promise<Instruction[]> {
  const createAta = await createBaseAtaInstruction(mint, payer, buyer);
  const bondingCurve = await pda(PUMP, ["bonding-curve", bytes(encoder.encode(mint))]);
  return [
    createAta,
    {
      programAddress: PUMP,
      accounts: [
        { address: await pda(PUMP, ["global"]), role: AccountRole.READONLY },
        { address: mint, role: AccountRole.READONLY },
        { address: WSOL, role: AccountRole.READONLY },
        { address: TOKEN_2022, role: AccountRole.READONLY },
        { address: TOKEN, role: AccountRole.READONLY },
        { address: bondingCurve, role: AccountRole.WRITABLE },
        { address: await tokenAccount(bondingCurve, mint, TOKEN_2022), role: AccountRole.WRITABLE },
        { address: await tokenAccount(bondingCurve, WSOL, TOKEN), role: AccountRole.WRITABLE },
        { address: buyer.address, role: AccountRole.WRITABLE_SIGNER, signer: buyer },
        { address: await tokenAccount(buyer.address, mint, TOKEN_2022), role: AccountRole.WRITABLE },
        { address: await tokenAccount(buyer.address, WSOL, TOKEN), role: AccountRole.WRITABLE },
        {
          address: await pda(PUMP, ["user_volume_accumulator", bytes(encoder.encode(buyer.address))]),
          role: AccountRole.WRITABLE,
        },
        { address: FEE_CONFIG, role: AccountRole.READONLY },
        { address: BUYBACK, role: AccountRole.WRITABLE },
        { address: SYSTEM, role: AccountRole.READONLY },
        { address: await pda(PUMP, ["__event_authority"]), role: AccountRole.READONLY },
        { address: PUMP, role: AccountRole.READONLY },
      ] as Instruction["accounts"],
      data: concat([BUY_EXACT_V3, u64(quoteIn), u64(minTokensOut)]),
    },
  ];
}

export async function sellV3Instruction(
  mint: Address,
  seller: TransactionSigner,
  amount: bigint,
  minSolOutput = 0n,
): Promise<Instruction> {
  const bondingCurve = await pda(PUMP, ["bonding-curve", bytes(encoder.encode(mint))]);
  return {
    programAddress: PUMP,
    accounts: [
      { address: await pda(PUMP, ["global"]), role: AccountRole.READONLY },
      { address: mint, role: AccountRole.READONLY },
      { address: WSOL, role: AccountRole.READONLY },
      { address: TOKEN_2022, role: AccountRole.READONLY },
      { address: TOKEN, role: AccountRole.READONLY },
      { address: bondingCurve, role: AccountRole.WRITABLE },
      { address: await tokenAccount(bondingCurve, mint, TOKEN_2022), role: AccountRole.WRITABLE },
      { address: await tokenAccount(bondingCurve, WSOL, TOKEN), role: AccountRole.WRITABLE },
      { address: seller.address, role: AccountRole.WRITABLE_SIGNER, signer: seller },
      { address: await tokenAccount(seller.address, mint, TOKEN_2022), role: AccountRole.WRITABLE },
      { address: await tokenAccount(seller.address, WSOL, TOKEN), role: AccountRole.WRITABLE },
      {
        address: await pda(PUMP, ["user_volume_accumulator", bytes(encoder.encode(seller.address))]),
        role: AccountRole.WRITABLE,
      },
      { address: FEE_CONFIG, role: AccountRole.READONLY },
      { address: BUYBACK, role: AccountRole.WRITABLE },
      { address: SYSTEM, role: AccountRole.READONLY },
      { address: await pda(PUMP, ["__event_authority"]), role: AccountRole.READONLY },
      { address: PUMP, role: AccountRole.READONLY },
    ] as Instruction["accounts"],
    data: concat([SELL_V3, u64(amount), u64(minSolOutput)]),
  };
}

export async function closeBaseAccountInstruction(mint: Address, owner: TransactionSigner, destination: Address): Promise<Instruction> {
  return {
    programAddress: TOKEN_2022,
    accounts: [
      { address: await tokenAccount(owner.address, mint, TOKEN_2022), role: AccountRole.WRITABLE },
      { address: destination, role: AccountRole.WRITABLE },
      { address: owner.address, role: AccountRole.WRITABLE_SIGNER, signer: owner },
    ] as Instruction["accounts"],
    data: Uint8Array.of(9),
  };
}

export async function closeVolumeInstruction(owner: TransactionSigner): Promise<Instruction> {
  return {
    programAddress: PUMP,
    accounts: [
      { address: owner.address, role: AccountRole.WRITABLE_SIGNER, signer: owner },
      {
        address: await pda(PUMP, ["user_volume_accumulator", bytes(encoder.encode(owner.address))]),
        role: AccountRole.WRITABLE,
      },
      { address: await pda(PUMP, ["__event_authority"]), role: AccountRole.READONLY },
      { address: PUMP, role: AccountRole.READONLY },
    ] as Instruction["accounts"],
    data: CLOSE_VOLUME,
  };
}

export async function latestBlockhash(rpcUrl: string): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
  const latest = await rpc<{ value: { blockhash: string; lastValidBlockHeight: number } }>(rpcUrl, "getLatestBlockhash", [
    { commitment: "confirmed" },
  ]);
  return latest.value;
}

export async function compileV1(
  feePayer: TransactionSigner,
  instructions: Instruction[],
  lifetime: { blockhash: string; lastValidBlockHeight: number },
): Promise<{ wire: string; bytes: number; signature: string }> {
  const message = pipe(
    createTransactionMessage({ version: 1 }),
    (current) => setTransactionMessageFeePayerSigner(feePayer, current),
    (current) =>
      setTransactionMessageLifetimeUsingBlockhash(
        {
          blockhash: lifetime.blockhash as Parameters<
            typeof setTransactionMessageLifetimeUsingBlockhash
          >[0]["blockhash"],
          lastValidBlockHeight: BigInt(lifetime.lastValidBlockHeight),
        },
        current,
      ),
    (current) => setTransactionMessageComputeUnitLimit(1_400_000, current),
    (current) => setTransactionMessageLoadedAccountsDataSizeLimit(32_000_000, current),
    (current) => appendTransactionMessageInstructions(instructions, current),
  );
  const signed = await signTransactionMessageWithSigners(message);
  const wire = getBase64EncodedWireTransaction(signed);
  return { wire, bytes: Buffer.from(wire, "base64").length, signature: getSignatureFromTransaction(signed) };
}
