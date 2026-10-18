import { FundingError, MachineFetchError } from './errors.js';
/** Largest ERC-20/TIP-20 decimal value representable by the uint8 convention. */
const maxTokenDecimals = 255;
/** Whether a value is a valid token decimal count. */
export function isTokenDecimals(value) {
    return Number.isSafeInteger(value) && value >= 0 && value <= maxTokenDecimals;
}
/** Whether a value is a 0x-prefixed 20-byte hex EVM address, ignoring checksum case. */
export function isEvmAddress(value) {
    return /^0x[\da-fA-F]{40}$/.test(value);
}
/** Whether a network is a canonical CAIP-2 EVM chain, `eip155:<chainId>` without leading zeros. */
export function isEvmNetwork(network) {
    return /^eip155:[1-9]\d*$/.test(network);
}
/**
 * Comparable form of an asset or account identifier on a network. EVM addresses on EVM networks
 * compare case-insensitively; every other identifier must match exactly.
 */
export function canonicalIdentifier(network, identifier) {
    return (identifier !== undefined && isEvmNetwork(network) && isEvmAddress(identifier)
        ? identifier.toLowerCase()
        : identifier);
}
/** Key identifying an asset on a network, consistent with {@link canonicalIdentifier}. */
export function assetKey(asset) {
    return JSON.stringify([asset.network, canonicalIdentifier(asset.network, asset.asset)]);
}
/** Rejects attempt IDs that cannot identify a request. */
export function assertAttemptId(attemptId) {
    if (typeof attemptId !== 'string' || !attemptId.trim())
        throw new MachineFetchError('Attempt ID must be a non-empty string', {
            code: 'INVALID_CONFIGURATION',
        });
}
/** Rejects a payer that cannot identify a signing account. */
export function assertPayer(payer) {
    if (typeof payer !== 'string' || !payer.trim())
        throw new MachineFetchError('Payer must be a non-empty string', {
            code: 'INVALID_CONFIGURATION',
        });
}
/** Whether an optional payer is `account`; EVM addresses compare case-insensitively. */
export function isPayer(payer, account) {
    return (payer === undefined ||
        payer === account ||
        (isEvmAddress(payer) && payer.toLowerCase() === account.toLowerCase()));
}
/** Whether a value is a non-array object. */
export function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
/** Validates the shared optional quote settings of route-quoting funders. */
export function assertQuoteOptions(options) {
    if (options.concurrency !== undefined &&
        (!Number.isInteger(options.concurrency) || options.concurrency <= 0))
        throw new FundingError('concurrency must be a positive integer', {
            code: 'INVALID_CONFIGURATION',
        });
    if (options.timeoutMs !== undefined && !isPositive(options.timeoutMs))
        throw new FundingError('timeoutMs must be a positive number', { code: 'INVALID_CONFIGURATION' });
}
/** Whether a value is a finite number greater than zero. */
export function isPositive(value) {
    return Number.isFinite(value) && value > 0;
}
//# sourceMappingURL=validate.js.map