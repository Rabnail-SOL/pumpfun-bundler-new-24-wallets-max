import { address, createKeyPairSignerFromBytes, type Instruction, type TransactionSigner } from "@solana/kit";
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import { payer, rpcUrl, sol, tipLamports } from "./config.js";
import { jitoCall } from "./jito.js";
import { launchKeysPath, loadLaunchKeys } from "./keys.js";
import { BUNDLE_TX_LIMIT, WALLETS_PER_BUY_TX, chunk } from "./plan.js";
import {
  PUMP,
  TOKEN_2022,
  closeBaseAccountInstruction,
  closeVolumeInstruction,
  compileV1,
  latestBlockhash,
  sellV3Instruction,
  transferInstruction,
} from "./pump.js";
import { balance, rpc, sendTransaction, simulate, simulationLine, waitForSignature } from "./rpc.js";

const keys = loadLaunchKeys(launchKeysPath());
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const TOKEN_PROGRAM = new PublicKey(TOKEN_2022);
const PUMP_PROGRAM = new PublicKey(PUMP);

function baseAta(owner: string, mint: string): string {
  const [derived] = PublicKey.findProgramAddressSync(
    [new PublicKey(owner).toBuffer(), TOKEN_PROGRAM.toBuffer(), new PublicKey(mint).toBuffer()],
    ATA_PROGRAM,
  );
  return derived.toBase58();
}

function volumeAddress(owner: string): string {
  const [derived] = PublicKey.findProgramAddressSync(
    [Buffer.from("user_volume_accumulator"), new PublicKey(owner).toBuffer()],
    PUMP_PROGRAM,
  );
  return derived.toBase58();
}

async function tokenAmount(owner: string, mint: string): Promise<bigint> {
  const result = await rpc<{ value: { data: [string, string] } | null }>(rpcUrl, "getAccountInfo", [
    baseAta(owner, mint),
    { encoding: "base64", commitment: "confirmed" },
  ]);
  if (!result.value) return 0n;
  return Buffer.from(result.value.data[0], "base64").readBigUInt64LE(64);
}

async function accountExists(account: string): Promise<boolean> {
  const result = await rpc<{ value: unknown }>(rpcUrl, "getAccountInfo", [account, { encoding: "base64", commitment: "confirmed" }]);
  return result.value != null;
}

async function submit(main: TransactionSigner, instructions: Instruction[], label: string): Promise<void> {
  if (instructions.length === 0) {
    console.log(`${label}: nothing to do`);
    return;
  }
  const compiled = await compileV1(main, instructions, await latestBlockhash(rpcUrl));
  const simulation = await simulate(rpcUrl, compiled.wire);
  console.log(simulationLine(label, simulation, compiled.bytes, instructions.length));
  if (simulation.err) {
    console.log(simulation.logs?.slice(-30).join("\n") ?? "");
    throw new Error(`${label} simulation failed`);
  }
  const signature = await sendTransaction(rpcUrl, compiled.wire);
  await waitForSignature(rpcUrl, signature);
  console.log(`${label}: https://solscan.io/tx/${signature}`);
}

const main = await createKeyPairSignerFromBytes(payer.secretKey);
if (main.address !== keys.mainWallet) {
  throw new Error(`Main wallet ${main.address} does not match the saved launch keys (${keys.mainWallet})`);
}
const buyers = await Promise.all(keys.buyers.map((buyer) => createKeyPairSignerFromBytes(bs58.decode(buyer.secretKey))));
const mint = address(keys.mint.publicKey);
const before = await balance(rpcUrl, main.address);

const sellGroups: Instruction[][] = [];
for (const buyer of buyers) {
  const amount = await tokenAmount(buyer.address, mint);
  console.log(`${buyer.address} balance: ${amount} base units`);
  if (amount > 0n) sellGroups.push([await sellV3Instruction(mint, buyer, amount, 0n)]);
}
const sellTxs = chunk(sellGroups, WALLETS_PER_BUY_TX).map((group) => group.flat());
if (sellTxs.length > BUNDLE_TX_LIMIT - 1) {
  throw new Error(`Sell bundle would need ${sellTxs.length} sell transactions plus a tip; Jito allows ${BUNDLE_TX_LIMIT}`);
}

if (sellTxs.length === 0) {
  console.log("sell: nothing to do");
} else {
  const { result: tipAccounts } = await jitoCall("/api/v1/getTipAccounts", "getTipAccounts", []);
  const liveTip = (tipAccounts as string[])[0];
  if (!liveTip) throw new Error("Jito returned no tip account");
  const lifetime = await latestBlockhash(rpcUrl);
  const compiled = await Promise.all(sellTxs.map((instructions) => compileV1(main, instructions, lifetime)));
  const tipTx = await compileV1(main, [transferInstruction(main, liveTip as TransactionSigner["address"], BigInt(tipLamports))], lifetime);
  for (const [index, tx] of compiled.entries()) {
    const simulation = await simulate(rpcUrl, tx.wire);
    if (simulation.err) {
      console.log(simulation.logs?.slice(-30).join("\n") ?? "");
      throw new Error(`sell ${index + 1} simulation failed: ${JSON.stringify(simulation.err)}`);
    }
    console.log(simulationLine(`sell ${index + 1}`, simulation, tx.bytes));
  }
  const submitted = await jitoCall(
    "/api/v1/bundles",
    "sendBundle",
    [[...compiled.map((tx) => tx.wire), tipTx.wire], { encoding: "base64" }],
    { failover: true },
  );
  console.log(`sell bundle accepted by ${submitted.endpoint}`);
  console.log(`bundle id: ${submitted.result}`);
  for (const tx of compiled) await waitForSignature(rpcUrl, tx.signature, 90_000);
  compiled.forEach((tx, index) => console.log(`sell ${index + 1}: https://solscan.io/tx/${tx.signature}`));
}

console.log("reclaiming token accounts outside the bundle");
for (const group of chunk(buyers, WALLETS_PER_BUY_TX)) {
  const closes: Instruction[] = [];
  for (const buyer of group) {
    if ((await tokenAmount(buyer.address, mint)) === 0n && (await accountExists(baseAta(buyer.address, mint)))) {
      closes.push(await closeBaseAccountInstruction(mint, buyer, buyer.address));
    }
    if (await accountExists(volumeAddress(buyer.address))) closes.push(await closeVolumeInstruction(buyer));
  }
  await submit(main, closes, "close accounts");

  const sweeps: Instruction[] = [];
  for (const buyer of group) {
    const lamports = await balance(rpcUrl, buyer.address);
    if (lamports > 0) sweeps.push(transferInstruction(buyer, main.address, BigInt(lamports)));
  }
  await submit(main, sweeps, "sweep");
}

const after = await balance(rpcUrl, main.address);
console.log(`main wallet ${main.address}: ${sol(before)} SOL -> ${sol(after)} SOL`);
