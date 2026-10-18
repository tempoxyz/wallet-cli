import type * as Challenge from '../Challenge.js';
import type { MaybePromise } from './types.js';
type MethodLike = {
    canHandleChallenge?: ((parameters: {
        challenge: Challenge.Challenge;
    }) => boolean) | undefined;
    intent: string;
    name: string;
};
/** Supported challenge paired with the configured client method that can sign it. */
export type ChallengeCandidate<method extends MethodLike = MethodLike> = method extends MethodLike ? {
    challenge: Challenge.Challenge<Record<string, unknown>, method['intent'], method['name']>;
    index: number;
    method: method;
} : never;
/**
 * Hook for filtering and sorting supported challenges before credential creation.
 *
 * Return candidates in preference order. The SDK signs the first returned
 * candidate. Return an empty array to reject all offered challenges.
 */
export type OrderChallenges<methods extends readonly MethodLike[]> = (candidates: readonly ChallengeCandidate<methods[number]>[]) => MaybePromise<readonly ChallengeCandidate<methods[number]>[]>;
/** Typed `method/intent` key for a configured payment capability. */
export type Key<methods extends readonly MethodLike[]> = methods[number] extends infer mi ? mi extends {
    name: infer name extends string;
    intent: infer intent extends string;
} ? `${name}/${intent}` : never : never;
/** Method keys grouped by method name for ergonomic config callbacks. */
export type KeyTree<methods extends readonly MethodLike[]> = {
    [name in methods[number]['name']]: {
        [mi in Extract<methods[number], {
            name: name;
        }> as mi['intent']]: `${mi['name']}/${mi['intent']}`;
    };
};
/** Per-capability q-values keyed by typed `method/intent` strings. */
export type Definition<methods extends readonly MethodLike[]> = Partial<Record<Key<methods>, number>>;
/**
 * Accept-Payment configuration.
 *
 * Callers may provide a plain definition map or a callback that receives a
 * typed key tree for authoring preferences without string literals.
 */
export type Config<methods extends readonly MethodLike[]> = Definition<methods> | ((keys: KeyTree<methods>) => Definition<methods>);
/** Parsed Accept-Payment entry with its original declaration order. */
export type Entry = {
    intent: string | '*';
    method: string | '*';
    q: number;
    index: number;
};
/** Resolved negotiation data derived from client methods and config. */
export type Resolved<methods extends readonly MethodLike[]> = {
    definition: Definition<methods>;
    entries: Entry[];
    header: string;
    keys: KeyTree<methods>;
};
/** Builds the typed key tree used by callback-style preference config. */
export declare function buildKeys<const methods extends readonly MethodLike[]>(methods: methods): KeyTree<methods>;
/** Resolves configured payment preferences into a header string and parsed entries. */
export declare function resolve<const methods extends readonly MethodLike[]>(methods: methods, config?: Config<methods>): Resolved<methods>;
/** Parses an `Accept-Payment` header into normalized preference entries. */
export declare function parse(header: string): Entry[];
/** Serializes preference entries to an `Accept-Payment` header value. */
export declare function serialize(entries: readonly Omit<Entry, 'index'>[] | readonly Entry[]): string;
/**
 * Orders offered payment methods by the best matching client preference.
 *
 * More specific matches win before comparing q-values, so an explicit opt-out
 * like `tempo/charge;q=0` overrides a broader wildcard such as `tempo/*;q=1`.
 */
export declare function rank<const offer extends {
    intent: string;
    method: string;
}>(offers: readonly offer[], preferences: readonly Entry[]): offer[];
/** Selects the best supported challenge from a set of server offers. */
export declare function selectChallenge<const methods extends readonly MethodLike[]>(challenges: readonly Challenge.Challenge[], methods: methods, preferences: readonly Entry[]): {
    challenge: Challenge.Challenge;
    method: methods[number];
} | undefined;
/** Returns supported challenge candidates ordered by client payment preferences. */
export declare function selectChallengeCandidates<const methods extends readonly MethodLike[]>(challenges: readonly Challenge.Challenge[], methods: methods, preferences: readonly Entry[]): ChallengeCandidate<methods[number]>[];
/** Returns the canonical `method/intent` key for a method or challenge-like value. */
export declare function keyOf(value: {
    intent: string;
    method?: string;
    name?: string;
}): string;
export {};
//# sourceMappingURL=AcceptPayment.d.ts.map