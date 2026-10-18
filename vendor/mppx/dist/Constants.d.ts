/** HTTP header names used by the Payment authentication scheme. */
export declare const Headers: {
    readonly acceptPayment: 'Accept-Payment';
    readonly authorization: 'Authorization';
    readonly paymentAuthorization: 'Payment-Authorization';
    readonly paymentReceipt: 'Payment-Receipt';
    readonly paymentSession: 'Payment-Session';
    readonly paymentSessionSnapshot: 'Payment-Session-Snapshot';
    readonly wwwAuthenticate: 'WWW-Authenticate';
};
/** Authentication scheme names used by mppx transports. */
export declare const Schemes: {
    readonly payment: 'Payment';
};
/** Payment method names used by built-in mppx methods. */
export declare const Methods: {
    readonly evm: 'evm';
    readonly stripe: 'stripe';
    readonly tempo: 'tempo';
};
/** Payment intent names used by built-in mppx methods. */
export declare const Intents: {
    readonly charge: 'charge';
    readonly session: 'session';
    readonly subscription: 'subscription';
};
/** Method detail object keys used by built-in methods. */
export declare const MethodDetailKeys: {
    readonly sessionProtocol: 'sessionProtocol';
    readonly sessionSnapshot: 'sessionSnapshot';
};
/** Tempo session protocol versions advertised under `request.methodDetails`. */
export declare const SessionProtocols: {
    /** Legacy contract-backed Tempo session protocol. */
    readonly v1: 'v1';
    /** TIP-1034 precompile-backed Tempo session protocol. */
    readonly v2: 'v2';
};
/** Known Tempo session protocol version markers. */
export type SessionProtocol = (typeof SessionProtocols)[keyof typeof SessionProtocols];
type MethodDetailKey = (typeof MethodDetailKeys)[keyof typeof MethodDetailKeys];
/**
 * Reads a typed method detail value from a challenge request.
 */
export declare function getMethodDetail<Value>(methodDetails: unknown, key: MethodDetailKey): Value | undefined;
export {};
//# sourceMappingURL=Constants.d.ts.map