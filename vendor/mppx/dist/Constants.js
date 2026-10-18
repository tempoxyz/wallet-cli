/** HTTP header names used by the Payment authentication scheme. */
export const Headers = {
    acceptPayment: 'Accept-Payment',
    authorization: 'Authorization',
    paymentAuthorization: 'Payment-Authorization',
    paymentReceipt: 'Payment-Receipt',
    paymentSession: 'Payment-Session',
    paymentSessionSnapshot: 'Payment-Session-Snapshot',
    wwwAuthenticate: 'WWW-Authenticate',
};
/** Authentication scheme names used by mppx transports. */
export const Schemes = {
    payment: 'Payment',
};
/** Payment method names used by built-in mppx methods. */
export const Methods = {
    evm: 'evm',
    stripe: 'stripe',
    tempo: 'tempo',
};
/** Payment intent names used by built-in mppx methods. */
export const Intents = {
    charge: 'charge',
    session: 'session',
    subscription: 'subscription',
};
/** Method detail object keys used by built-in methods. */
export const MethodDetailKeys = {
    sessionProtocol: 'sessionProtocol',
    sessionSnapshot: 'sessionSnapshot',
};
/** Tempo session protocol versions advertised under `request.methodDetails`. */
export const SessionProtocols = {
    /** Legacy contract-backed Tempo session protocol. */
    v1: 'v1',
    /** TIP-1034 precompile-backed Tempo session protocol. */
    v2: 'v2',
};
/**
 * Reads a typed method detail value from a challenge request.
 */
export function getMethodDetail(methodDetails, key) {
    if (!methodDetails || typeof methodDetails !== 'object')
        return undefined;
    return methodDetails[key];
}
//# sourceMappingURL=Constants.js.map