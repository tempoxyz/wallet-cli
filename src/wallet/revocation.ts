import { Rpc, type Provider as CoreProvider } from "accounts";
import { z } from "incur";
import type { Address } from "viem";
import { Actions } from "viem/tempo";

import { networkError, usageError } from "../shared/errors.js";
import { createTempoPublicClient } from "../shared/network.js";
import { localAccessKeyStatus } from "./access-key.js";
import type { WalletState } from "./store.js";

export type RevokeProvider = Pick<CoreProvider.Provider, "request">;

/** An access key's state in the AccountKeychain precompile, where revocation takes effect. */
type OnChainKey = { status: "published" | "revoked" | "missing"; expiry: number | undefined };

export type OnChainKeyReader = (options: {
  chainId: number;
  walletAddress: Address;
  accessKeyAddress: Address;
}) => Promise<OnChainKey>;

/**
 * Asks the wallet app to revoke a key and returns whether the chain then shows it revoked, since
 * the wallet app can return without revoking a key it could not find on-chain. `stored` is the
 * key's local copy, if any.
 */
export async function revokeThroughWallet(options: {
  provider: RevokeProvider;
  readKey: OnChainKeyReader;
  stored: WalletState["accessKeys"][number] | undefined;
  target: { chainId: number; walletAddress: Address; accessKeyAddress: Address };
}) {
  const { provider, readKey, stored, target } = options;
  // A key that is not published yet is authorized and revoked in one transaction; revoking it
  // alone would leave its signed authorization publishable.
  const keyAuthorization =
    stored &&
    localAccessKeyStatus(stored) === "pending" &&
    (await readKey(target)).status === "missing"
      ? stored.keyAuthorization
      : undefined;
  await revokeAccessKeyThroughWallet({ provider, ...target, keyAuthorization });
  return (await readKey(target)).status === "revoked";
}

/**
 * The wallet app signs the revocation, so the root account needs no local signer.
 * `wallet_revokeAccessKey` takes no chain: the wallet revokes on the provider's active chain,
 * which must be the key's.
 */
async function revokeAccessKeyThroughWallet(options: {
  provider: RevokeProvider;
  walletAddress: Address;
  accessKeyAddress: Address;
  chainId: number;
  keyAuthorization: unknown;
}) {
  const activeChainId = Number(await options.provider.request({ method: "eth_chainId" }));
  if (activeChainId !== options.chainId)
    throw usageError(
      "Wallet is not configured for the requested network. Run 'tempo wallet login'.",
    );
  await options.provider.request({
    method: "wallet_revokeAccessKey",
    params: [
      // Encoded as the SDK encodes the request, from the stored signed authorization.
      z.encode(Rpc.wallet_revokeAccessKey.parameters, {
        address: options.walletAddress,
        accessKeyAddress: options.accessKeyAddress,
        ...(options.keyAuthorization
          ? { keyAuthorization: options.keyAuthorization as never }
          : {}),
      }),
    ],
  });
}

export async function readAccessKeyOnChain(options: {
  chainId: number;
  walletAddress: Address;
  accessKeyAddress: Address;
}): Promise<OnChainKey> {
  const metadata = await Actions.accessKey
    .getMetadata(createTempoPublicClient(options.chainId), {
      account: options.walletAddress,
      accessKey: options.accessKeyAddress,
    })
    .catch(() => {
      throw networkError(
        `Unable to read access key ${options.accessKeyAddress.toLowerCase()} on-chain. Check RPC connectivity (TEMPO_RPC_URL).`,
      );
    });
  return {
    status: metadata.isRevoked
      ? "revoked"
      : metadata.address.toLowerCase() === options.accessKeyAddress.toLowerCase()
        ? "published"
        : "missing",
    // Zero means the key never expires.
    expiry: metadata.expiry > 0n ? Number(metadata.expiry) : undefined,
  };
}
