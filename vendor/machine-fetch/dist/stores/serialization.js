import { OperationStoreError } from '../core/errors.js';
import { isEvmAddress, isRecord, isTokenDecimals } from '../core/validate.js';
const prefix = '~machine-fetch:';
/**
 * Marks a released generation where one slot holds either a reference or a release. Provider
 * references never contain NUL, and {@link checkReference} rejects any that do.
 */
export const releasedReference = '\u0000released';
/** Versioned JSON with escaped string tags so provider data cannot collide with bigint values. */
export function serialize(operation) {
    return JSON.stringify({ version: 1, operation }, (_key, value) => {
        if (typeof value === 'bigint')
            return `${prefix}bigint:${value}`;
        if (typeof value === 'string' && value.startsWith(prefix))
            return `${prefix}string:${value}`;
        if (typeof value === 'function' || typeof value === 'symbol')
            throw new OperationStoreError('Operation data must be JSON serializable');
        return value;
    });
}
/** Corrupt, incompatible, or incomplete records fail closed instead of appearing absent. */
export function deserialize(serialized, id) {
    const record = parse(serialized);
    if (!isRecord(record) || record.version !== 1 || !isOperation(record.operation, id))
        throw new OperationStoreError('Invalid operation record');
    return record.operation;
}
/** The operation ID a record claims to hold; {@link deserialize} still validates the record. */
export function recordId(serialized) {
    const record = parse(serialized);
    const id = isRecord(record) && isRecord(record.operation) ? record.operation.id : undefined;
    if (!isText(id))
        throw new OperationStoreError('Invalid operation record');
    return id;
}
function parse(serialized) {
    try {
        return JSON.parse(serialized, (_key, value) => {
            if (typeof value !== 'string')
                return value;
            if (value.startsWith(`${prefix}string:`))
                return value.slice(`${prefix}string:`.length);
            if (value.startsWith(`${prefix}bigint:`))
                return BigInt(value.slice(`${prefix}bigint:`.length));
            return value;
        });
    }
    catch (cause) {
        throw new OperationStoreError('Invalid operation record', { cause });
    }
}
/** References are immutable once attached, including when writes race or are retried. */
export function checkReference(operation, reference) {
    if (!operation)
        throw new OperationStoreError('Unknown operation');
    if (!reference.trim())
        throw new OperationStoreError('Operation reference must not be empty');
    if (reference.includes('\u0000'))
        throw new OperationStoreError('Operation reference must not contain NUL');
    if (operation.reference !== undefined && operation.reference !== reference)
        throw new OperationStoreError('Conflicting operation reference');
}
/** Only an operation without a submission reference may be released. */
export function checkRelease(operation) {
    if (!operation)
        throw new OperationStoreError('Unknown operation');
    if (operation.reference !== undefined)
        throw new OperationStoreError('Cannot release a submitted operation');
}
/** Reports every backend failure, such as I/O or quota errors, as OperationStoreError. */
export function guardStore(store) {
    const guarded = (method) => async (...args) => {
        try {
            return await method(...args);
        }
        catch (cause) {
            if (cause instanceof OperationStoreError)
                throw cause;
            throw new OperationStoreError('Operation store failed', { cause });
        }
    };
    return Object.freeze({
        get: guarded(store.get),
        list: guarded(store.list),
        claim: guarded(store.claim),
        setReference: guarded(store.setReference),
        release: guarded(store.release),
    });
}
/** Whether a parsed record has the complete operation schema for `id`. */
function isOperation(value, id) {
    return (isRecord(value) &&
        value.id === id &&
        isText(id) &&
        isText(value.route) &&
        isText(value.requirementKey) &&
        isRequest(value.request, id) &&
        isQuote(value.quote) &&
        (value.reference === undefined || isReference(value.reference)));
}
function isRequest(value, id) {
    return (isRecord(value) &&
        value.operationId === id &&
        typeof value.amountOut === 'bigint' &&
        Number.isSafeInteger(value.deadline) &&
        Number.isInteger(value.maxSlippageBps) &&
        isAccount(value.from) &&
        isAccount(value.to));
}
function isAccount(value) {
    return (isRecord(value) &&
        typeof value.owner === 'string' &&
        isEvmAddress(value.owner) &&
        typeof value.asset === 'string' &&
        isEvmAddress(value.asset) &&
        Number.isSafeInteger(value.chainId) &&
        value.chainId > 0 &&
        value.network === `eip155:${value.chainId}` &&
        isText(value.currency) &&
        isTokenDecimals(value.decimals));
}
function isQuote(value) {
    return (isRecord(value) &&
        typeof value.amountIn === 'bigint' &&
        isText(value.reference) &&
        Number.isSafeInteger(value.expiresAt) &&
        typeof value.amountOut === 'bigint' &&
        typeof value.minAmountOut === 'bigint' &&
        (value.maxAmountIn === undefined || typeof value.maxAmountIn === 'bigint') &&
        (value.fees === undefined || (Array.isArray(value.fees) && value.fees.every(isFee))));
}
function isFee(value) {
    return (isRecord(value) &&
        isText(value.network) &&
        isText(value.asset) &&
        typeof value.amount === 'bigint' &&
        (value.kind === 'provider' || value.kind === 'gas') &&
        typeof value.includedInAmountIn === 'boolean');
}
function isReference(value) {
    return typeof value === 'string' && value.trim() !== '' && !value.includes('\u0000');
}
function isText(value) {
    return typeof value === 'string' && value !== '';
}
