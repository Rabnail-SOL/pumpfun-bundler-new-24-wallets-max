import { chmodSync, readFileSync, writeFileSync } from "node:fs";

export type WalletRecord = { publicKey: string; secretKey: string };

export type LaunchKeys = {
  mainWallet: string;
  buySol: string;
  fundLamports: string;
  mint: WalletRecord;
  buyers: WalletRecord[];
};

export function launchKeysPath(): URL {
  return new URL("../launch-keys.json", import.meta.url);
}

export function saveLaunchKeys(path: URL, record: LaunchKeys): void {
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function loadLaunchKeys(path: URL): LaunchKeys {
  const record = JSON.parse(readFileSync(path, "utf8")) as LaunchKeys;
  if (!record.mainWallet || !record.mint?.publicKey || !record.mint.secretKey || !Array.isArray(record.buyers) || record.buyers.length === 0) {
    throw new Error(`${path.pathname} is missing the mint or buyer wallets`);
  }
  return record;
}
