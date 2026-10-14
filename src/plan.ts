const SIGNATURE_FEE_LAMPORTS = 5_000;

/** A combined ATA create plus buy_exact_quote_in_v3 fits six wallets before the instruction-trace cap. */
export const WALLETS_PER_BUY_TX = 6;
/** Jito accepts at most five transactions. One is the create, so four buy transactions remain. */
export const BUNDLE_TX_LIMIT = 5;
export const MAX_WALLETS = WALLETS_PER_BUY_TX * (BUNDLE_TX_LIMIT - 1);
/** Rent-exempt minimum for an empty system account. */
export const WALLET_RENT_LAMPORTS = 890_880n;
/** Rent for a Token-2022 associated token account with the immutable-owner extension. */
export const ATA_RENT_LAMPORTS = 2_074_080n;
/** Headroom for the mint, bonding curve, and the funding transaction fee. */
export const CREATE_RESERVE_LAMPORTS = 20_000_000;

export function buyTransactionCount(walletCount: number): number {
  return Math.ceil(walletCount / WALLETS_PER_BUY_TX);
}

export function groupSizeAt(walletCount: number, txIndex: number): number {
  const remaining = walletCount - txIndex * WALLETS_PER_BUY_TX;
  return Math.min(WALLETS_PER_BUY_TX, Math.max(remaining, 0));
}

/** Extra lamports the lead wallet of a buy transaction needs: ATA rent for the group, plus the transaction fee. */
export function leaderExtra(walletCount: number, txIndex: number): bigint {
  const size = BigInt(groupSizeAt(walletCount, txIndex));
  return ATA_RENT_LAMPORTS * size + BigInt(SIGNATURE_FEE_LAMPORTS) * size;
}

export function leaderExtras(walletCount: number): bigint[] {
  return Array.from({ length: buyTransactionCount(walletCount) }, (_, txIndex) => leaderExtra(walletCount, txIndex));
}

export function chunk<T>(items: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) groups.push(items.slice(index, index + size));
  return groups;
}
