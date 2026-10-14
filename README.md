# jito-bundler-24-wallets

Launches a Token-2022 coin on pump.fun and buys it from up to 24 wallets in one Jito bundle. A later command sells those wallets in one bundle, then closes the token accounts and sweeps the SOL back to the main wallet.

## Bundle

Jito accepts 5 transactions. One creates the coin. The other four buy.

Each buy transaction holds 6 wallets, because a combined token-account create and `buy_exact_quote_in_v3` hits the instruction-trace limit at the 7th wallet. That is why 24 is the maximum: `4 × 6`.

| Bundle transaction | Who signs | What it does |
| --- | --- | --- |
| 1 | Main wallet | `create_v2` and one Jito tip for the whole bundle |
| 2 | Wallet 1 | ATA create and exact-SOL buy for wallets 1–6 |
| 3 | Wallet 7 | ATA create and exact-SOL buy for wallets 7–12 |
| 4 | Wallet 13 | ATA create and exact-SOL buy for wallets 13–18 |
| 5 | Wallet 19 | ATA create and exact-SOL buy for wallets 19–24 |

`BUY_SOL` is the exact amount spent on each buy. The program calculates the tokens. The quote walks the bonding curve from wallet 1 through the last wallet, so later buys use the price after the earlier buys in the same bundle. `SLIPPAGE_BPS` lowers the minimum tokens accepted.

Here is simple test result you can check.
```
Bundle ID: 68e31a6a7ad6c7229525dd0b407a6cf41aaa0da8fd0bf20f0ab1c8a2f0eef5a4 (2 tx for demo, one tx is for creation, one tx is for 6 wallet sets)
Token Mint: DfB6BesYF8ehEGQc9Rzxs72ef8uosqHdWhK3JkjfUrg6
Create + jito tip tx: https://solscan.io/tx/3JSUQJPjAq2KVbGcg5rfpz9bjYy6kMxyumg32XgPN5oaLkfsX2pVneY4o3jRJt7rZt6ZAKNztuZ3QueUvQFMbj7r
6 wallets buy tx: https://solscan.io/tx/3hiApaXQCdzsWXosXSou1ELo944hqpBXz1eSw2vSRDJWATaVRL4WEGdiwdQKWvzvkBDBnFDq5fBj9bhwq6w3WAK6
```

The main wallet funds the buyers first, outside the bundle. Every buyer receives `BUY_SOL`, plus 0.001844 SOL for the volume account and 0.000891 SOL so the wallet stays rent-exempt. The lead wallet of each buy transaction also receives the token-account rent and transaction fee for that transaction. The buy transactions do not include the main wallet.

With fewer than 24 wallets the later buy transactions are omitted. 10, 15, and 20 are valid.

## Setup

```bash
cd jito-bundler-24-wallets
npm install
cp .env.example .env
```

Fill `RPC_URL` and `PRIVATE_KEY` in `.env`. The private key is the main wallet, as base58 or a JSON byte array.

## Commands

```bash
npm run launch      # fund the buyers, then submit the Jito bundle on mainnet
npm run sell        # sell bundle, then close accounts and sweep
npm run typecheck
```

`npm run launch` writes `launch-keys.json`. That file holds the buyer and mint secret keys and is gitignored. `npm run sell` refuses to run when the `.env` wallet does not match `mainWallet` in that file.

Sell transactions are groups of 6, plus one tip transaction from the main wallet, still inside a single Jito bundle. Closing token accounts and sweeping SOL happens afterward, one confirmed batch at a time, outside the bundle.

## Environment

| Name | Default | Role |
| --- | --- | --- |
| `RPC_URL` | required | Mainnet RPC |
| `PRIVATE_KEY` | required | Main wallet secret |
| `JITO_BLOCK_ENGINE` | mainnet block engine | Bundle submission, with regional failover |
| `TIP_SOL` | `0.001` | Jito tip paid by the main wallet |
| `BUY_SOL` | `0.005` | Exact SOL spent by each buy |
| `WALLET_COUNT` | `24` | Buyer count, from 1 to 24 |
| `SLIPPAGE_BPS` | `100` | Minimum-token discount, in basis points |
| `TOKEN_NAME` | `Bundle Test` | Coin name |
| `TOKEN_SYMBOL` | `BTEST` | Coin symbol |
| `TOKEN_URI` | example metadata URL | Coin metadata URI |

A 24-wallet launch at `0.005` SOL needs about `0.27` SOL on the main wallet. Launch stops if the balance is short of the funding amount, the tip, and create-account reserve.
