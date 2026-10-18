import { Base64 } from 'ox';
const maxUint96 = (1n << 96n) - 1n;
/** Returns whether a bigint can be encoded as a TIP20EscrowChannel `uint96` amount. */
export function isUint96(value) {
    return value >= 0n && value <= maxUint96;
}
/** Parses an unsigned decimal raw amount when it fits TIP-1034's `uint96` range. */
export function parseUint96Amount(value) {
    if (!/^\d{1,29}$/.test(value))
        return undefined;
    const amount = BigInt(value);
    return isUint96(amount) ? amount : undefined;
}
/** Converts a bigint into a TIP20EscrowChannel `uint96` amount after validating bounds. */
export function uint96(value) {
    assertUint96(value);
    return value;
}
/** Asserts that a bigint can be encoded as a TIP20EscrowChannel `uint96` amount. */
export function assertUint96(value) {
    if (!isUint96(value))
        throw new Error(`Value ${value} is outside uint96 bounds.`);
}
const sessionCredentialActions = new Set(['open', 'topUp', 'voucher', 'close']);
function isObject(value) {
    return value !== null && typeof value === 'object';
}
/** Returns whether a value is a supported session credential action. */
export function isSessionCredentialAction(value) {
    return typeof value === 'string' && sessionCredentialActions.has(value);
}
/** Returns whether a value has the session credential fields needed by transports. */
export function isSessionCredentialContext(value) {
    if (value === null || typeof value !== 'object')
        return false;
    const candidate = value;
    if (typeof candidate.channelId !== 'string')
        return false;
    if (candidate.action !== undefined && !isSessionCredentialAction(candidate.action))
        return false;
    return true;
}
/** Reads the shared session credential context or throws the provided error message. */
export function requireSessionCredentialContext(value, errorMessage = 'No session credential context available.') {
    if (!isSessionCredentialContext(value))
        throw new Error(errorMessage);
    return value;
}
/** Reads the raw per-unit session amount from a payment challenge. */
export function readSessionChallengeAmount(challenge) {
    const amount = challenge.request.amount;
    if (typeof amount !== 'string')
        throw new Error('Session challenge is missing amount.');
    return BigInt(amount);
}
/** Returns whether a value is a typed need-voucher event payload. */
export function isNeedVoucherEvent(value) {
    if (!isObject(value))
        return false;
    return (typeof value.channelId === 'string' &&
        typeof value.requiredCumulative === 'string' &&
        typeof value.acceptedCumulative === 'string' &&
        typeof value.deposit === 'string');
}
/** Returns whether a value is a typed session payment receipt. */
export function isSessionReceipt(value) {
    if (!isObject(value))
        return false;
    return (value.method === 'tempo' &&
        value.intent === 'session' &&
        value.status === 'success' &&
        typeof value.timestamp === 'string' &&
        typeof value.reference === 'string' &&
        typeof value.challengeId === 'string' &&
        typeof value.channelId === 'string' &&
        typeof value.acceptedCumulative === 'string' &&
        typeof value.spent === 'string' &&
        (value.units === undefined || typeof value.units === 'number') &&
        (value.txHash === undefined || typeof value.txHash === 'string'));
}
/**
 * Create a session receipt.
 */
export function createSessionReceipt(params) {
    return {
        method: 'tempo',
        intent: 'session',
        status: 'success',
        timestamp: new Date().toISOString(),
        reference: params.channelId,
        challengeId: params.challengeId,
        channelId: params.channelId,
        acceptedCumulative: params.acceptedCumulative.toString(),
        spent: params.spent.toString(),
        ...(params.units !== undefined && { units: params.units }),
        ...(params.txHash !== undefined && { txHash: params.txHash }),
    };
}
/**
 * Serialize a session receipt to the Payment-Receipt header format.
 */
export function serializeSessionReceipt(receipt) {
    const json = JSON.stringify(receipt);
    return Base64.fromString(json, { pad: false, url: true });
}
/**
 * Deserialize a Payment-Receipt header value to a session receipt.
 */
export function deserializeSessionReceipt(encoded) {
    const json = Base64.toString(encoded);
    const value = JSON.parse(json);
    if (!isSessionReceipt(value))
        throw new Error('Invalid session receipt.');
    return value;
}
/** Returns whether a response carries an SSE event stream. */
export function isEventStream(response) {
    const ct = response.headers.get('content-type');
    return ct?.toLowerCase().startsWith('text/event-stream') ?? false;
}
/**
 * Format a session receipt as a Server-Sent Event.
 *
 * Produces a valid SSE event string with `event: payment-receipt`
 * and the receipt JSON as the `data` field.
 */
export function formatReceiptEvent(receipt) {
    return `event: payment-receipt\ndata: ${JSON.stringify(receipt)}\n\n`;
}
/**
 * Format a need-voucher event as a Server-Sent Event.
 *
 * Emitted when the channel balance is exhausted mid-stream.
 */
export function formatNeedVoucherEvent(params) {
    return `event: payment-need-voucher\ndata: ${JSON.stringify(params)}\n\n`;
}
/**
 * Format an application message as SSE, preserving embedded newlines.
 *
 * SSE requires multi-line payloads to be emitted as separate `data:` fields.
 */
export function formatMessageEvent(value) {
    const data = String(value)
        .split('\n')
        .map((line) => `data: ${line}`)
        .join('\n');
    return `event: message\n${data}\n\n`;
}
/**
 * Parse a raw SSE event string into a typed event.
 *
 * Unknown event names fall back to `message`, which preserves compatibility
 * with generic SSE producers.
 */
export function parseEvent(raw) {
    let eventType = 'message';
    const dataLines = [];
    for (const line of raw.split('\n')) {
        if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
        }
        else if (line.startsWith('data: ')) {
            dataLines.push(line.slice(6));
        }
        else if (line === 'data:') {
            dataLines.push('');
        }
    }
    if (dataLines.length === 0)
        return null;
    const data = dataLines.join('\n');
    switch (eventType) {
        case 'message':
            return { type: 'message', data };
        case 'payment-need-voucher': {
            const parsed = parseJson(data);
            return isNeedVoucherEvent(parsed) ? { type: 'payment-need-voucher', data: parsed } : null;
        }
        case 'payment-receipt': {
            const parsed = parseJson(data);
            return isSessionReceipt(parsed) ? { type: 'payment-receipt', data: parsed } : null;
        }
        default:
            return { type: 'message', data };
    }
}
function parseJson(raw) {
    try {
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
/** Extracts the `data:` field value from a single SSE event block. */
export function extractData(event) {
    const dataLines = [];
    for (const line of event.split('\n')) {
        if (line.startsWith('data: '))
            dataLines.push(line.slice(6));
        else if (line === 'data:')
            dataLines.push('');
    }
    return dataLines.length > 0 ? dataLines.join('\n') : null;
}
/** Formats the initial or follow-up payment authorization frame. */
export function formatAuthorizationMessage(authorization) {
    return JSON.stringify({ mpp: 'authorization', authorization });
}
/** Formats an application payload frame. */
export function formatApplicationMessage(data) {
    return JSON.stringify({ mpp: 'message', data });
}
/** Formats the client request for a final close-ready receipt. */
export function formatCloseRequestMessage() {
    return JSON.stringify({ mpp: 'payment-close-request' });
}
/** Formats the server close-ready receipt frame. */
export function formatCloseReadyMessage(receipt) {
    return JSON.stringify({ mpp: 'payment-close-ready', data: receipt });
}
/** Formats a server request for a larger voucher. */
export function formatNeedVoucherMessage(params) {
    return JSON.stringify({ mpp: 'payment-need-voucher', data: params });
}
/** Formats an intermediate or final payment receipt frame. */
export function formatReceiptMessage(receipt) {
    return JSON.stringify({ mpp: 'payment-receipt', data: receipt });
}
/** Formats a payment protocol error frame. */
export function formatErrorMessage(parameters) {
    return JSON.stringify({ mpp: 'payment-error', ...parameters });
}
/** Parses a WebSocket payment protocol frame, returning null for application data. */
export function parseMessage(raw) {
    const parsed = parseJsonObject(raw);
    if (!parsed)
        return null;
    if (parsed.mpp === 'authorization' && typeof parsed.authorization === 'string')
        return { mpp: 'authorization', authorization: parsed.authorization };
    if (parsed.mpp === 'message' && typeof parsed.data === 'string')
        return { mpp: 'message', data: parsed.data };
    if (parsed.mpp === 'payment-close-request')
        return { mpp: 'payment-close-request' };
    if (parsed.mpp === 'payment-close-ready' && isSessionReceipt(parsed.data))
        return { mpp: 'payment-close-ready', data: parsed.data };
    if (parsed.mpp === 'payment-error' &&
        typeof parsed.status === 'number' &&
        typeof parsed.message === 'string')
        return { mpp: 'payment-error', status: parsed.status, message: parsed.message };
    if (parsed.mpp === 'payment-need-voucher' && isNeedVoucherEvent(parsed.data))
        return { mpp: 'payment-need-voucher', data: parsed.data };
    if (parsed.mpp === 'payment-receipt' && isSessionReceipt(parsed.data))
        return { mpp: 'payment-receipt', data: parsed.data };
    return null;
}
function parseJsonObject(raw) {
    try {
        const value = JSON.parse(raw);
        if (value === null || typeof value !== 'object')
            return null;
        return value;
    }
    catch {
        return null;
    }
}
/** Canonical TIP-1034 TIP-20 Channel Escrow precompile address. */
export const tip20ChannelEscrow = '0x4d50500000000000000000000000000000000000';
//# sourceMappingURL=Protocol.js.map