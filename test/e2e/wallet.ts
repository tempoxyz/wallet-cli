import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { Account as TempoAccount, Actions, Addresses } from "viem/tempo";

import { type Localnet, tempoClient } from "./localnet.js";

/** A spending limit the wallet owner signs into the access key's authorization. */
export type KeyLimit = { token: Address; limit: bigint };

export type LocalWallet = {
  /** HOME for CLI subprocesses; holds the wallet store. */
  home: string;
  /** The wallet (root) account the access key spends for. */
  address: Address;
  accessKey: Address;
};

/**
 * A logged-in wallet on the local Tempo chain, as `tempo wallet login` leaves it: a root account
 * holding `funds` and `feeBalance` pathUSD, and an unpublished secp256k1 access key in the wallet
 * store whose signed authorization carries `limits` and is published with its first transaction.
 */
export async function localWallet(
  net: Localnet,
  options: {
    funds?: KeyLimit[];
    limits?: KeyLimit[];
    feeBalance?: bigint;
    /** When the access key expires, in Unix seconds. @default a day from now */
    expiry?: number;
  } = {},
): Promise<LocalWallet> {
  const rootKey = generatePrivateKey();
  const accessKeyPrivate = generatePrivateKey();
  const root = privateKeyToAccount(rootKey);
  const accessKey = privateKeyToAccount(accessKeyPrivate).address;
  const funds = options.funds ?? [{ token: net.ousd, limit: 10_000_000n }];
  // Fees count against the key's limits too, so it may also spend the pathUSD it pays fees in.
  const limits = options.limits ?? [
    { token: net.ousd, limit: 100_000_000n },
    { token: net.usdc, limit: 100_000_000n },
    { token: Addresses.pathUsd, limit: 1_000_000n },
  ];

  const issuer = tempoClient(net);
  for (const { token, limit } of funds)
    await Actions.token.mintSync(issuer, {
      token,
      to: root.address,
      amount: limit,
      feeToken: Addresses.pathUsd,
    });
  // The local node picks a fee token for a transaction that names none without the account's
  // FeeManager preference, sometimes pathUSD, so the wallet holds a little pathUSD for fees.
  await Actions.token.transferSync(issuer, {
    token: Addresses.pathUsd,
    to: root.address,
    amount: options.feeBalance ?? 100_000n,
    feeToken: Addresses.pathUsd,
  });

  const expiry = options.expiry ?? Math.floor(Date.now() / 1000) + 86_400;
  const keyAuthorization = await TempoAccount.fromSecp256k1(rootKey).signKeyAuthorization(
    { address: accessKey, type: "secp256k1" },
    { chainId: BigInt(net.tempoChainId), expiry, limits },
  );
  const home = await mkdtemp(join(tmpdir(), "wallet-cli-e2e-"));
  await mkdir(join(home, ".tempo", "wallet"), { recursive: true });
  await writeFile(
    join(home, ".tempo", "wallet", "store.json"),
    `${JSON.stringify(
      {
        "tempo-cli.store": {
          state: {
            accounts: [{ address: root.address }],
            accessKeys: [
              {
                address: accessKey,
                access: root.address,
                chainId: net.tempoChainId,
                expiry,
                keyType: "secp256k1",
                privateKey: accessKeyPrivate,
                limits,
                keyAuthorization,
              },
            ],
            activeAccount: 0,
            chainId: net.tempoChainId,
          },
          version: 0,
        },
      },
      (_key, value: unknown) => (typeof value === "bigint" ? `${value}#__bigint` : value),
      2,
    )}\n`,
    { mode: 0o600 },
  );
  return { home, address: root.address, accessKey };
}
