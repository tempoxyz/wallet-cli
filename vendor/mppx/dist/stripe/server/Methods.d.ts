import { charge as evmCharge } from '../../evm/server/Charge.js';
import type * as Method from '../../Method.js';
import { charge as tempoCharge } from '../../tempo/server/Charge.js';
import { session as tempoSession } from '../../tempo/session/server/Session.js';
import * as PaymentIntent from '../internal/payment-intent.js';
import type { StripeClient } from '../internal/types.js';
import { charge as charge_ } from './Charge.js';
import { findOrCreateDepositAddress as _findOrCreateDepositAddress } from './internal/deposit-address.js';
import { type ConnectConfig } from './internal/request.js';
export declare namespace stripe {
    type Network = 'tempo' | 'base' | 'solana';
    type ResolvePaymentIntentOptionsContext = PaymentIntent.ResolveOptionsContext;
    type DepositAddress<N extends Network = Network> = string & {
        readonly __brand: 'StripeDepositAddress';
        readonly __network: N;
    };
    type Parameters = {
        client: StripeClient;
        networkId: string;
        livemode: boolean;
        hostedFeePayer?: boolean | undefined;
        connect?: ConnectConfig;
        depositAddresses?: Partial<Record<Network, string>> | ((network: Network) => Promise<string>);
        metadata?: Record<string, string> | undefined;
    };
}
type CustomRailFactory = (address: string) => Method.AnyServer | readonly Method.AnyServer[];
type ServerOf<N extends string, I extends string> = Omit<Method.AnyServer, 'name' | 'intent'> & {
    name: N;
    intent: I;
};
type TempoServer = ServerOf<'tempo', 'charge'>;
type TempoSessionServer = ServerOf<'tempo', 'session'>;
type SptServer = ServerOf<'stripe', 'charge'>;
type EvmServer = ServerOf<'evm', 'charge'>;
type BaseConfig = {
    x402: NonNullable<Parameters<typeof evmCharge>[0]['x402']>;
} & Partial<Omit<Parameters<typeof evmCharge>[0], 'currency' | 'recipient' | 'x402'>>;
type CustomRailNetwork = Exclude<stripe.Network, 'tempo' | 'base'>;
type AdditionalConfig = {
    base?: BaseConfig;
    tempo?: {
        session: Omit<tempoSession.Parameters, 'currency' | 'recipient'>;
    };
} & {
    [K in CustomRailNetwork]?: CustomRailFactory;
};
type DefaultMethods = readonly [TempoServer, SptServer];
type DefaultMethodsWithAdditional<C extends AdditionalConfig> = readonly [
    TempoServer,
    SptServer,
    ...(C extends {
        base: object;
    } ? [EvmServer] : []),
    ...(C extends {
        tempo: {
            session: any;
        };
    } ? [TempoSessionServer] : [])
];
type DefaultMethodName = 'tempo' | 'spt';
type DefaultMethodsConfig = {
    exclude?: DefaultMethodName[];
};
type SyncMethodsResult = DefaultMethods & {
    additional<C extends AdditionalConfig>(config: C): DefaultMethodsWithAdditional<C>;
};
interface StripeMachinePayments<P extends stripe.Parameters = stripe.Parameters> {
    spt: {
        charge: (params?: {
            paymentMethodTypes?: string[];
        }) => SptServer;
    };
    tempo: {
        charge: (params: {
            recipient: stripe.DepositAddress<'tempo'>;
            metadata?: Record<string, string>;
        } & Partial<Omit<Parameters<typeof tempoCharge>[0], 'currency' | 'recipient'>>) => TempoServer;
        session: (params: {
            recipient: stripe.DepositAddress<'tempo'>;
        } & Omit<tempoSession.Parameters, 'currency' | 'recipient'>) => TempoSessionServer;
    };
    base: {
        charge: (params: {
            recipient: stripe.DepositAddress<'base'>;
            metadata?: Record<string, string>;
        } & BaseConfig) => EvmServer;
    };
    findOrCreateDepositAddress: <N extends stripe.Network>(network: N) => Promise<stripe.DepositAddress<N>>;
    defaultMethods: (config?: DefaultMethodsConfig) => P['depositAddresses'] extends (network: stripe.Network) => Promise<string> ? DefaultMethodsBuilder : SyncMethodsResult;
}
declare class DefaultMethodsBuilder implements PromiseLike<DefaultMethods> {
    #private;
    constructor(resolve: (additional?: AdditionalConfig) => Promise<any>);
    additional<C extends AdditionalConfig>(config: C): PromiseLike<DefaultMethodsWithAdditional<C>>;
    then<T = DefaultMethods, U = never>(onfulfilled?: ((value: DefaultMethods) => T | PromiseLike<T>) | null, onrejected?: ((reason: unknown) => U | PromiseLike<U>) | null): Promise<T | U>;
}
/**
 * Creates a configured Stripe machine payments instance.
 *
 * @example
 * ```ts
 * import { Mppx, stripe } from 'mppx/server'
 *
 * const machinePayments = stripe.create({
 *   client: stripeClient,
 *   networkId: process.env.STRIPE_PROFILE_ID!,
 *   livemode: !process.env.STRIPE_SECRET_KEY!.includes('_test_'),
 * })
 *
 * // Async: deposit addresses resolved from Stripe API
 * const mppx = Mppx.create({
 *   methods: await machinePayments.defaultMethods(),
 *   secretKey: mppSecretKey,
 * })
 * ```
 *
 * @example
 * ```ts
 * // Sync: deposit addresses provided statically
 * const machinePayments = stripe.create({
 *   client: stripeClient,
 *   networkId: process.env.STRIPE_PROFILE_ID!,
 *   livemode: !process.env.STRIPE_SECRET_KEY!.includes('_test_'),
 *   depositAddresses: { tempo: process.env.TEMPO_DEPOSIT_ADDRESS! },
 * })
 *
 * const mppx = Mppx.create({
 *   methods: machinePayments.defaultMethods(),
 *   secretKey: mppSecretKey,
 * })
 * ```
 *
 * @example
 * ```ts
 * // With additional custom rails
 * const mppx = Mppx.create({
 *   methods: await machinePayments.defaultMethods().additional({
 *     base: { x402: { facilitator } },
 *     solana: (address) => solana.charge({ recipient: address, currency: USDC, decimals: 6 }),
 *   }),
 *   secretKey: mppSecretKey,
 * })
 * ```
 *
 * PaymentIntent option resolvers run after non-mutating method validation, when
 * available, and before the terminal payment operation. If Stripe later rejects
 * resolved optional fields while recording a completed crypto payment, mppx
 * retries the recording once without them. SPT payments do not use this fallback.
 */
export declare function stripe<const P extends stripe.Parameters>(parameters: P): StripeMachinePayments<P>;
export declare namespace stripe {
    const spt: typeof charge_;
    /** @deprecated Use `stripe.create({ ... }).spt.charge()` or `stripe.spt()` instead. */
    const charge: typeof charge_;
    const create: typeof stripe;
    const findOrCreateDepositAddress: typeof _findOrCreateDepositAddress;
}
export {};
//# sourceMappingURL=Methods.d.ts.map