import { Transaction } from 'viem/tempo';
import type { LooseOmit, NoExtraKeys } from '../../internal/types.js';
import * as Method from '../../Method.js';
import type * as Html from '../../server/internal/html/config.ts';
import * as Store from '../../Store.js';
import * as Client from '../../viem/Client.js';
import * as Account from '../internal/account.js';
import * as FeePayer from '../internal/fee-payer.js';
import type * as types from '../internal/types.js';
import * as Methods from '../Methods.js';
import * as Relay from './Relay.js';
import * as SponsorBudget from './SponsorBudget.js';
/**
 * Creates a Tempo charge method intent for usage on the server.
 *
 * @example
 * ```ts
 * import { tempo } from 'mppx/server'
 *
 * const charge = tempo.charge()
 * ```
 */
export declare function charge<const parameters extends charge.Parameters>(parameters?: NoExtraKeys<parameters, charge.Parameters>): Method.Server<typeof Methods.charge, charge.DeriveDefaults<parameters>>;
export declare namespace charge {
    type StoreItemMap = {
        [key: `mppx:charge:${string}`]: number | SponsorBudget.State | Store.ReplayMarker;
    };
    type Defaults = LooseOmit<Method.RequestDefaults<typeof Methods.charge>, 'feePayer' | 'recipient'>;
    type ValidateSender = (parameters: ValidateSenderParameters) => boolean | Promise<boolean>;
    type ValidationDetails = {
        mode: 'proof' | 'pull' | 'push';
        sender?: `0x${string}` | undefined;
        serializedTransaction?: Transaction.TransactionSerializedTempo | undefined;
        transfers?: readonly ExpectedTransfer[] | undefined;
    };
    type ValidateSenderParameters = {
        /** Actual TIP-20 `Transfer.from` address. */
        sender: `0x${string}`;
        /** Address that mppx would normally require as the sender. */
        expectedSender: `0x${string}`;
        /** Parsed hash credential source when the credential includes one. */
        source?: {
            address: `0x${string}`;
            chainId: number;
        } | undefined;
    };
    type Parameters = {
        /**
         * Tokens permitted for sponsored charge transaction fees, including tokens
         * selected by a remote fee payer. Local sponsorship defaults to pathUSD and
         * USDC.e on mainnet, and pathUSD on other chains. Hosted sponsorship has no
         * token allowlist by default and trusts the configured provider's choice.
         * A custom list replaces the local defaults and restricts hosted sponsorship.
         * It must contain at least one token. Address validation and other sponsorship
         * checks still apply. This does not change the payment currency or sessions.
         */
        allowedFeeTokens?: readonly `0x${string}`[] | undefined;
        /** Enables first-party machine-token funding through the canonical swapper. */
        machineTokenEnabled?: boolean | undefined;
        /** Render payment page when Accept header is text/html (e.g. in browsers) */
        html?: boolean | Html.Config | undefined;
        /**
         * Override the fee-sponsor policy used when co-signing Tempo charge
         * transactions. Defaults resolve per chain, including a higher
         * priority-fee ceiling on Moderato. Aggregate in-flight exposure is
         * configured separately with `sponsorBudget`.
         */
        feePayerPolicy?: FeePayerPolicy | undefined;
        /**
         * Token a local fee payer uses to pay gas. If omitted, mppx selects a
         * funded allowed token in `allowedFeeTokens` order (pathUSD first by default).
         * An explicit token must also be in the allowed list.
         *
         * This option is not supported with a remote fee-payer URL, which selects
         * its own token.
         */
        feeToken?: `0x${string}` | undefined;
        /** Testnet mode. */
        testnet?: boolean | undefined;
        /**
         * Store for charge replay protection.
         *
         * Non-zero charge flows default to an in-memory store if omitted. For
         * zero-dollar proof auth, replay prevention is enabled only when a store
         * is explicitly provided; otherwise proofs remain reusable until the
         * challenge expires.
         *
         * Replay protection requires a {@link Store.AtomicStore} so replay markers
         * can be written atomically.
         *
         * Use a shared store in multi-instance deployments so consumed hashes and
         * proofs are visible across all server instances.
         */
        store?: Store.AtomicStore | undefined;
        /**
         * Validates a TIP-20 transfer sender when it differs from the credential
         * source. Core verification still validates amount, currency, recipient,
         * memo binding, transaction success, and replay protection.
         */
        validateSender?: ValidateSender | undefined;
        /**
         * Prefix prepended to charge replay-protection store keys.
         *
         * By default, no prefix is applied.
         */
        storeKeyPrefix?: string | undefined;
        /**
         * Delegates Tempo charge credential validation and broadcast to Tempo API
         * or a compatible MPP relay.
         *
         * The adapter delegates finalization to the relay for both modes. The
         * relay broadcasts pull credentials, while it recognizes a push
         * credential as already broadcast and returns its receipt without sending
         * it again.
         *
         */
        relay?: RelayOptions | undefined;
        /**
         * Configures aggregate in-flight fee exposure for sponsored transactions.
         *
         * Set to `false` only when aggregate exposure is enforced outside mppx.
         * The configured store must be shared by every process using the sponsor.
         * @default `{}`
         */
        sponsorBudget?: SponsorBudgetConfig | false | undefined;
        /**
         * Whether to wait for the charge transaction to confirm on-chain before
         * responding. @default true
         *
         * When `false`, the transaction is simulated via `eth_estimateGas` and
         * broadcast without waiting for inclusion. The receipt will optimistically
         * report `status: 'success'` based on simulation alone — if the
         * transaction reverts on-chain after broadcast (e.g. due to a state
         * change between simulation and inclusion), the receipt will not reflect
         * the failure.
         */
        waitForConfirmation?: boolean | undefined;
    } & Client.getResolver.Parameters & Account.resolve.Parameters & Defaults & Method.ComposableHooks<typeof Methods.charge>;
    type DeriveDefaults<parameters extends Parameters> = types.DeriveDefaults<parameters, Defaults, {
        currency: string;
        decimals: number;
    }>;
    type FeePayerPolicy = Partial<FeePayer.Policy> & {
        /**
         * Maximum number of sponsored transactions awaiting a terminal receipt.
         * @deprecated Use `sponsorBudget.maxInFlightReservations`.
         */
        maxInFlightReservations?: number | undefined;
        /**
         * Maximum aggregate declared fee exposure awaiting terminal receipts.
         *
         * @deprecated Use `sponsorBudget.maxInFlightTotalFee`.
         */
        maxInFlightTotalFee?: bigint | undefined;
    };
    type SponsorBudgetConfig = {
        /** Maximum number of sponsored transactions awaiting a terminal receipt. @default 100 */
        maxInFlightReservations?: number | undefined;
        /** Maximum aggregate declared fee exposure. @default `feePayerPolicy.maxTotalFee * 10` */
        maxInFlightTotalFee?: bigint | undefined;
        /** Atomic store shared by every process using the sponsor. Defaults to `store`. */
        store?: Store.AtomicStore | undefined;
    };
    /** Tempo API relay configuration for server-side charges. */
    type RelayOptions = Relay.configure.Options;
}
type ExpectedTransfer = {
    amount: string;
    allowAnyMemo?: boolean | undefined;
    memo?: `0x${string}` | undefined;
    recipient: `0x${string}`;
};
export {};
//# sourceMappingURL=Charge.d.ts.map