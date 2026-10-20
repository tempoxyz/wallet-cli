/**
 * Mppx integration beyond `MachineFetch.create`: adapt an existing Mppx client, extend the Mppx CLI,
 * or normalize an Mppx challenge.
 * @module
 */
import type { Challenge } from 'mppx';
import type { Mppx, Transport } from 'mppx/client';
import { type FromMppxOptions, type MppxClient, type MppxExtension, type MppxExtensionOptions } from '../adapters/mppx.js';
import type { PaymentClient, PaymentRequirement } from '../interfaces/payment.js';
import type * as Errors from './Errors.js';
export type { MppxClient as Client, MppxExtension as Extension, MppxPreparation as Preparation, } from '../adapters/mppx.js';
/**
 * Adapts an existing Mppx client into a payment client for `MachineFetch.from`, reusing its
 * methods, transport, and raw fetch. Mppx does not expose its other create-time settings, so supply
 * them again in `options`. The client supplies Tempo auto-swap as its own funder; see `autoSwap`.
 */
export declare const client: <const methods extends Mppx.Methods, const transport extends Transport.AnyTransport>(client: MppxClient<methods, transport>, options?: client.Options<methods, transport>) => PaymentClient<unknown>;
export declare namespace client {
    /** Mppx create-time settings the existing client does not expose. */
    type Options<methods extends Mppx.Methods = Mppx.Methods, transport extends Transport.AnyTransport = Transport.Transport> = FromMppxOptions<methods, transport>;
    /** Errors {@link client} can throw while validating options. */
    type ErrorType = Errors.InvalidConfigurationErrorType | Errors.GlobalErrorType;
}
/**
 * Creates an Mppx CLI extension backed by machine-fetch policy and funders. Each payment uses the
 * host's operation ID, or a random one, and the host's signal, when it supplies one.
 */
export declare const extension: (options?: extension.Options) => MppxExtension;
export declare namespace extension {
    /** Options for {@link extension}. */
    type Options = MppxExtensionOptions;
    /** Errors {@link extension} can throw while validating options. */
    type ErrorType = Errors.InvalidConfigurationErrorType | Errors.GlobalErrorType;
}
/** Normalizes an Mppx challenge into the payment requirement policy and funders evaluate. */
export declare const requirement: (challenge: Challenge.Challenge) => PaymentRequirement;
