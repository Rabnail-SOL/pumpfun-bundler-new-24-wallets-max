import { createKeyPairSignerFromBytes, type Instruction, type TransactionSigner } from "@solana/kit";
import bs58 from "bs58";
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  buyLamports,
  payer,
  rpcUrl,
  slippageBps,
  sol,
  tipLamports,
  tokenName,
  tokenSymbol,
  tokenUri,
  walletCount,
} from "./config.js";
import { tokens } from "./format.js";
import { jitoCall } from "./jito.js";
import { launchKeysPath, saveLaunchKeys } from "./keys.js";
import {
  BUNDLE_TX_LIMIT,
  CREATE_RESERVE_LAMPORTS,
  WALLET_RENT_LAMPORTS,
  WALLETS_PER_BUY_TX,
  chunk,
  groupSizeAt,
  leaderExtras,
} from "./plan.js";
import {
  VOLUME_ACCOUNT_RENT,
  compileV1,
  createV2Instruction,
  exactQuoteBuyInstructions,
  latestBlockhash,
  loadFreshCurve,
  quoteExactQuoteIn,
  transferInstruction,
} from "./pump.js";
import { balance, sendTransaction, simulate, simulationLine, traceOf, waitForSignature } from "./rpc.js";

const BUY_LAMPORTS = buyLamports;
const TIP_LAMPORTS = BigInt(tipLamports);
const FUND_LAMPORTS = BUY_LAMPORTS + VOLUME_ACCOUNT_RENT + WALLET_RENT_LAMPORTS;
const EXTRAS = leaderExtras(walletCount);
const KEYS_PATH = launchKeysPath();
const user = await createKeyPairSignerFromBytes(payer.secretKey);
const mintKeypair = Keypair.generate();
const buyerKeypairs = Array.from({ length: walletCount }, () => Keypair.generate());
const mint = await createKeyPairSignerFromBytes(mintKeypair.secretKey);
const buyers = await Promise.all(buyerKeypairs.map((keypair) => createKeyPairSignerFromBytes(keypair.secretKey)));

function leaderAt(txIndex: number) {
  const leader = buyers[txIndex * WALLETS_PER_BUY_TX];
  if (!leader) throw new Error(`Missing lead buyer for transaction ${txIndex + 1}`);
  return leader;
}

function fundedLamports(): number {
  return Number(FUND_LAMPORTS) * walletCount + EXTRAS.reduce((sum, extra) => sum + Number(extra), 0) + tipLamports;
}

const { result: tipAccounts } = await jitoCall("/api/v1/getTipAccounts", "getTipAccounts", []);
const liveTip = (tipAccounts as string[])[0];
if (!liveTip) throw new Error("Jito returned no tip account");

const before = await balance(rpcUrl, user.address);
const lifetime = await latestBlockhash(rpcUrl);
const leaders = EXTRAS.map((_, txIndex) => leaderAt(txIndex));
const fundInstructions = buyers.map((buyer, index) =>
  transferInstruction(user, buyer.address, FUND_LAMPORTS + (index % WALLETS_PER_BUY_TX === 0 ? EXTRAS[index / WALLETS_PER_BUY_TX] ?? 0n : 0n)),
);
const createBody = () => createV2Instruction(user, mint, tokenName, tokenSymbol, tokenUri);
const createInstructions = [
  await createBody(),
  transferInstruction(user, liveTip as TransactionSigner["address"], TIP_LAMPORTS),
];
const curve = await loadFreshCurve(rpcUrl);
let quotedCurve = curve;
const quotes = buyers.map((buyer) => {
  const quoted = quoteExactQuoteIn(quotedCurve, BUY_LAMPORTS);
  const minTokensOut = (quoted.tokensOut * (10_000n - slippageBps)) / 10_000n;
  quotedCurve = quoted.next;
  return { buyer, tokensOut: quoted.tokensOut, minTokensOut };
});
const buyGroups = await Promise.all(
  chunk(quotes, WALLETS_PER_BUY_TX).map(async (group, txIndex) => {
    const leader = leaders[txIndex];
    if (!leader) throw new Error(`Missing lead buyer for transaction ${txIndex + 1}`);
    return (
      await Promise.all(
        group.map((quote) => exactQuoteBuyInstructions(mint.address, leader, quote.buyer, BUY_LAMPORTS, quote.minTokensOut)),
      )
    ).flat();
  }),
);
if (buyGroups.some((instructions) => instructions.some((instruction) => instruction.accounts?.some((account) => account.address === user.address)))) {
  throw new Error("A buy transaction still includes the main wallet");
}
if (1 + buyGroups.length > BUNDLE_TX_LIMIT) {
  throw new Error(`Buy bundle would be ${1 + buyGroups.length} transactions; Jito allows ${BUNDLE_TX_LIMIT}`);
}

const fundTx = await compileV1(user, fundInstructions, lifetime);
const createTx = await compileV1(user, createInstructions, lifetime);
const buyTxs = await Promise.all(buyGroups.map((instructions, txIndex) => compileV1(leaderAt(txIndex), instructions, lifetime)));

console.log(`main wallet: ${user.address}`);
console.log(`mint: ${mint.address}`);
console.log(`token: ${tokenName} (${tokenSymbol})`);
console.log(`wallets: ${walletCount}`);
console.log(
  `each buy spends ${sol(Number(BUY_LAMPORTS))} SOL; funding adds ${sol(Number(VOLUME_ACCOUNT_RENT))} volume rent and ${sol(Number(WALLET_RENT_LAMPORTS))} wallet rent`,
);
console.log(`main wallet pays one ${sol(Number(TIP_LAMPORTS))} SOL Jito tip on the create transaction for the ${1 + buyGroups.length}-transaction bundle`);
leaders.forEach((leader, txIndex) => {
  console.log(
    `buy ${txIndex + 1} is signed by wallet ${txIndex * WALLETS_PER_BUY_TX + 1} (${leader.address}), which also holds ${sol(Number(EXTRAS[txIndex] ?? 0n))} SOL for that transaction's token-account rent and fee`,
  );
});
console.log(`slippage floor: ${slippageBps} bps`);
console.log(`setup tx: ${fundInstructions.length} transfers, ${fundTx.bytes} bytes`);
console.log(`bundle tx 1 create_v2: ${createTx.bytes} bytes, ${createInstructions.length} instructions`);
buyTxs.forEach((tx, index) => {
  console.log(
    `bundle tx ${index + 2} ATA + buy_exact_quote_in_v3: ${groupSizeAt(walletCount, index)} wallets, ${tx.bytes} bytes, ${buyGroups[index]?.length ?? 0} instructions`,
  );
});
for (const [index, quote] of quotes.entries()) {
  console.log(`wallet ${index + 1}: expected ${tokens(quote.tokensOut)} tokens, minimum ${tokens(quote.minTokensOut)}`);
}

const needed = fundedLamports() + CREATE_RESERVE_LAMPORTS;
if (before < needed) {
  console.error(`Need ${sol(needed)} SOL, have ${sol(before)} SOL. Fund ${user.address} before sending.`);
  process.exit(1);
}

const createSimulation = await simulate(rpcUrl, createTx.wire);
console.log(simulationLine("create simulation", createSimulation) + `  trace=${traceOf(createSimulation, createInstructions.length)}`);
if (createSimulation.err) {
  console.log(createSimulation.logs?.slice(-40).join("\n") ?? "");
  process.exit(1);
}

saveLaunchKeys(KEYS_PATH, {
  mainWallet: user.address,
  buySol: (Number(BUY_LAMPORTS) / LAMPORTS_PER_SOL).toString(),
  fundLamports: FUND_LAMPORTS.toString(),
  mint: { publicKey: mintKeypair.publicKey.toBase58(), secretKey: bs58.encode(mintKeypair.secretKey) },
  buyers: buyerKeypairs.map((keypair) => ({
    publicKey: keypair.publicKey.toBase58(),
    secretKey: bs58.encode(keypair.secretKey),
  })),
});
console.log(`buyer keys saved: ${KEYS_PATH.pathname}`);

async function sendCompiled(instructions: Instruction[], label: string): Promise<void> {
  const compiled = await compileV1(user, instructions, await latestBlockhash(rpcUrl));
  const signature = await sendTransaction(rpcUrl, compiled.wire);
  await waitForSignature(rpcUrl, signature);
  console.log(`${label}: https://solscan.io/tx/${signature}`);
}

await sendCompiled(fundInstructions, "funded buyers");

const bundleLifetime = await latestBlockhash(rpcUrl);
const liveCreate = await compileV1(user, [
  await createBody(),
  transferInstruction(user, liveTip as TransactionSigner["address"], TIP_LAMPORTS),
], bundleLifetime);
const liveBuys = await Promise.all(buyGroups.map((instructions, txIndex) => compileV1(leaderAt(txIndex), instructions, bundleLifetime)));
const liveCreateSimulation = await simulate(rpcUrl, liveCreate.wire);
if (liveCreateSimulation.err) {
  console.error(simulationLine("create simulation", liveCreateSimulation));
  console.error(liveCreateSimulation.logs?.slice(-20).join("\n") ?? "");
  process.exit(1);
}
const submitted = await jitoCall(
  "/api/v1/bundles",
  "sendBundle",
  [[liveCreate.wire, ...liveBuys.map((tx) => tx.wire)], { encoding: "base64" }],
  { failover: true },
);
console.log(`bundle accepted by ${submitted.endpoint}`);
console.log(`bundle id: ${submitted.result}`);
await waitForSignature(rpcUrl, liveCreate.signature, 90_000);
for (const tx of liveBuys) await waitForSignature(rpcUrl, tx.signature, 90_000);
console.log(`create: https://solscan.io/tx/${liveCreate.signature}`);
liveBuys.forEach((tx, index) => console.log(`buy ${index + 1}: https://solscan.io/tx/${tx.signature}`));
