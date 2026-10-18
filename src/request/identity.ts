import { Keystore } from "accounts";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Account as TempoAccount, Chain, KeyAuthorizationManager } from "viem/tempo";

import { usageError } from "../shared/errors.js";
import { parseNetwork, resolveNetwork, rpcUrl } from "../shared/network.js";
import { loadWallet, walletProblem, WalletRequiredError } from "../shared/require-wallet.js";
import { cleanStoredScalar } from "../shared/utils.js";
import { isPaymentCapableAccessKey } from "../wallet/access-key.js";
import { emptyWalletState, type WalletState } from "../wallet/store.js";
import type { RequestOptions } from "./options.js";

/** Private key that replaces the logged-in wallet as payer. Errors never echo the key. */
export function privateKeySigner(options: RequestOptions) {
  const source: "flag" | "env" = options.privateKey !== undefined ? "flag" : "env";
  const key = options.privateKey ?? (process.env.TEMPO_PRIVATE_KEY || undefined);
  if (key === undefined) return undefined;
  try {
    if (/^0x[0-9a-fA-F]{64}$/.test(key))
      return { account: privateKeyToAccount(key as `0x${string}`), source };
  } catch {
    // Out-of-range keys fall through; signer errors include the key value.
  }
  throw usageError(
    `${privateKeySourceName(source)} must be a valid private key (0x followed by 64 hex characters)`,
  );
}

function privateKeySourceName(source: "flag" | "env") {
  return source === "flag" ? "--private-key" : "TEMPO_PRIVATE_KEY";
}

export const privateKeyFlagWarning =
  "--private-key can leak through shell history and process listings; set TEMPO_PRIVATE_KEY instead";

export function writePrivateKeyNotice(
  stderr: Pick<NodeJS.WriteStream, "write">,
  options: RequestOptions,
) {
  const signer = privateKeySigner(options);
  if (!signer) return;
  stderr.write(
    `Paying with key from ${privateKeySourceName(signer.source)} (${signer.account.address}), not the logged-in wallet\n`,
  );
  if (signer.source === "flag") stderr.write(`Warning: ${privateKeyFlagWarning}\n`);
}

export async function resolvePaymentIdentity(options: RequestOptions) {
  const privateKeyPayer = privateKeyIdentity(options);
  if (privateKeyPayer) return privateKeyPayer;

  // Paying never starts a login or key refresh; the error names the command that does.
  const identity = await walletIdentity(options);
  if ("code" in identity) throw new WalletRequiredError(identity);
  return identity;
}

/** The payer when a private key replaces the logged-in wallet; it signs for itself. */
export function privateKeyIdentity(options: RequestOptions) {
  const signer = privateKeySigner(options);
  if (!signer) return undefined;
  const { account } = signer;
  const getClient = ({ chainId: requestedChainId }: { chainId?: number | undefined }) =>
    createWalletClient({
      account,
      chain:
        (requestedChainId ?? requestNetwork(options).chainId) === 42431
          ? Chain.tempoModerato
          : Chain.tempo,
      transport: http(rpcUrl(requestedChainId ?? requestNetwork(options).chainId)),
    });
  return {
    address: account.address,
    getClient,
    methodOptions: { account, mode: "pull" as const },
    signerAddress: account.address,
  };
}

/** The logged-in wallet's access-key payer, or the login or key problem that stops it paying. */
export async function walletIdentity(options: RequestOptions) {
  const wallet = await loadWallet(requestNetwork(options).name);
  if ("code" in wallet) return wallet;
  return (
    (await storedAccessKeyIdentity(wallet.state, options)) ??
    walletProblem("E_AUTH_REFRESH_REQUIRED", wallet.network)
  );
}

/**
 * The network a payment uses. A private-key payer is unrelated to the logged-in wallet, so that
 * wallet's chain never applies: only `--network`, `TEMPO_WALLET_NETWORK`, the saved `network`
 * setting, or the mainnet default.
 */
export function resolvePaymentNetwork(options: RequestOptions) {
  return resolveNetwork(
    options.network,
    privateKeySigner(options) ? emptyWalletState() : undefined,
  );
}

/** executeRequest resolves this before payment; mainnet only backs direct callers. */
export function requestNetwork(options: RequestOptions) {
  return parseNetwork(options.network ?? "mainnet");
}

export async function storedAccessKeyIdentity(walletState: WalletState, options: RequestOptions) {
  const activeAccount = walletState.accounts[walletState.activeAccount ?? 0];
  if (!activeAccount) return undefined;

  const expectedChain = requestNetwork(options).chainId;
  for (const key of walletState.accessKeys) {
    if (key.chainId !== expectedChain) continue;
    if (key.keyType && key.keyType !== "secp256k1" && key.keyType !== "p256") continue;
    if (key.access.toLowerCase() !== activeAccount.address.toLowerCase()) continue;
    if (!isPaymentCapableAccessKey(key)) continue;

    const keyAuthorizationManager = KeyAuthorizationManager.memory();
    if (key.keyAuthorization) {
      await keyAuthorizationManager.set(
        {
          address: activeAccount.address as `0x${string}`,
          accessKey: key.address as `0x${string}`,
          chainId: expectedChain,
        },
        key.keyAuthorization as never,
      );
    }

    let account;
    try {
      account = key.privateKey
        ? key.keyType === "p256"
          ? TempoAccount.fromP256(key.privateKey as `0x${string}`, {
              access: activeAccount.address as `0x${string}`,
              keyAuthorizationManager,
            })
          : TempoAccount.fromSecp256k1(key.privateKey as `0x${string}`, {
              access: activeAccount.address as `0x${string}`,
              keyAuthorizationManager,
            })
        : key.keyType === "p256" && key.handle && key.publicKey
          ? await Keystore.webCryptoP256({ extractable: true }).toAccount(
              {
                handle: key.handle as Keystore.Handle,
                keyType: key.keyType,
                publicKey: key.publicKey as `0x${string}`,
              },
              {
                access: activeAccount.address as `0x${string}`,
                keyAuthorizationManager,
              },
            )
          : undefined;
    } catch {
      // Signing material the signer rejects is as unusable as missing material.
      continue;
    }
    if (!account) continue;
    if (key.address.toLowerCase() !== account.accessKeyAddress.toLowerCase()) continue;

    const getClient = ({ chainId: requestedChainId }: { chainId?: number | undefined }) =>
      createWalletClient({
        account,
        chain:
          (requestedChainId ?? requestNetwork(options).chainId) === 42431
            ? Chain.tempoModerato
            : Chain.tempo,
        transport: http(rpcUrl(requestedChainId ?? requestNetwork(options).chainId)),
      });
    return {
      account,
      address: account.address,
      getClient,
      key,
      methodOptions: { account, getClient, mode: "pull" as const },
      signerAddress: account.accessKeyAddress,
    };
  }

  return undefined;
}

export type PaymentIdentity = Awaited<ReturnType<typeof resolvePaymentIdentity>>;

/**
 * The key's stored raw limit for `token`. Exact stored limits (`permissionSemantics: 1`) that
 * leave the token out allow it no spending; otherwise a missing limit is unknown or unrestricted.
 */
export function storedAccessKeyLimit(
  key: WalletState["accessKeys"][number] | undefined,
  token: string | undefined,
) {
  const stored = key?.limits?.find((entry) => entry.token.toLowerCase() === token?.toLowerCase());
  if (!stored) return key?.permissionSemantics === 1 && key.limits !== undefined ? 0n : null;
  const raw = cleanStoredScalar(stored.limit);
  return /^\d+$/.test(raw) ? BigInt(raw) : null;
}
