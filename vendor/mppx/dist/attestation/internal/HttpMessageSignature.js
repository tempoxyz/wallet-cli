import { isInnerList, parseDictionary, serializeItem, serializeDictionary, serializeInnerList, serializeParameters, } from 'structured-headers';
import * as Store from '../../Store.js';
import { Algorithms, Headers as AttestationHeaders } from '../Constants.js';
import * as SigningContextInternal from './SigningContext.js';
/** RFC 9421 constants used by request-attestation signature profiles. */
export const Constants = {
    /** Derived request components supported by this narrow request profile. */
    components: {
        /** The target host and non-default port. */
        authority: '@authority',
        /** The request URL path without its query string. */
        path: '@path',
        /** The lowercased `Signature-Agent` request header. */
        signatureAgent: 'signature-agent',
        /** The signature's canonicalized covered-components and parameters. */
        signatureParams: '@signature-params',
    },
};
const algorithmDescriptors = {
    [Algorithms.ed25519]: {
        hash: undefined,
        keyAlgorithm: 'Ed25519',
        webCryptoAlgorithm: 'Ed25519',
    },
    [Algorithms.rsaPssSha512]: {
        hash: 'SHA-512',
        keyAlgorithm: 'RSA-PSS',
        webCryptoAlgorithm: { name: 'RSA-PSS', saltLength: 64 },
    },
};
/** Signs a request using the configured RFC 9421-derived component list. */
export async function sign(request, options) {
    const context = options.context ?? SigningContextInternal.create();
    const created = context.created;
    const expires = created + (options.expiresIn ?? 60);
    const algorithm = algorithmFromKey(options.key);
    const parameters = new Map([
        ['created', created],
        ['expires', expires],
        ['keyid', options.keyId],
        ['alg', algorithm],
        ['nonce', context.nonce],
        ['tag', options.tag],
    ]);
    const input = {
        algorithm,
        components: options.components.map(toComponent),
        created,
        expires,
        keyId: options.keyId,
        label: options.label,
        nonce: context.nonce,
        parameters,
        tag: options.tag,
    };
    const signature = await crypto.subtle.sign(webCryptoAlgorithm(algorithm), options.key, toArrayBuffer(encode(signatureBase(request, input))));
    const headers = new Headers(request.headers);
    const inputs = parseHeaderDictionary(headers, AttestationHeaders.signatureInput);
    const signatures = parseHeaderDictionary(headers, AttestationHeaders.signature);
    if (!haveSameKeys(inputs, signatures))
        throw new Error('Signature-Input and Signature must contain the same labels.');
    if (inputs.has(input.label) || signatures.has(input.label))
        throw new Error(`HTTP message signature label "${input.label}" already exists.`);
    inputs.set(input.label, toInnerList(input));
    signatures.set(input.label, [signature, new Map()]);
    headers.set(AttestationHeaders.signatureInput, serializeDictionary(inputs));
    headers.set(AttestationHeaders.signature, serializeDictionary(signatures));
    return new Request(request, { headers });
}
/** Verifies a request signature, its lifetime, and optionally its nonce. */
export async function verify(request, options) {
    const parsed = parse(request, options.tag);
    if (!parsed)
        return { status: 'absent' };
    if (parsed.reason)
        return { status: 'invalid', reason: parsed.reason };
    if (!parsed.input || !parsed.signature)
        return { status: 'invalid', reason: 'The HTTP message signature is malformed.' };
    const { input, signature } = parsed;
    if (!options.requiredComponents.every((component) => hasComponent(input.components, component)))
        return {
            status: 'invalid',
            reason: 'The signature does not cover the required request components.',
        };
    const now = Math.floor(Date.now() / 1000);
    if (input.created > now || input.expires <= now || input.expires - input.created > options.maxAge)
        return { status: 'invalid', reason: 'The signature is expired or has an invalid lifetime.' };
    if (options.validate) {
        const reason = options.validate(input, request);
        if (reason)
            return { status: 'invalid', reason };
    }
    let key;
    try {
        key = await options.keyResolver({
            algorithm: input.algorithm,
            keyId: input.keyId,
            request,
        });
    }
    catch {
        return { status: 'unverified', reason: 'The public key could not be resolved.' };
    }
    if (!key)
        return {
            status: 'unverified',
            reason: 'No public key is available for the signature key ID.',
        };
    if (!keySupportsAlgorithm(key, input.algorithm))
        return {
            status: 'invalid',
            reason: 'The public key does not support the signature algorithm.',
        };
    if (options.validateKey) {
        const reason = await options.validateKey(key, input, request);
        if (reason)
            return { status: 'invalid', reason };
    }
    let valid;
    try {
        valid = await crypto.subtle.verify(webCryptoAlgorithm(input.algorithm), key, toArrayBuffer(signature), toArrayBuffer(encode(signatureBase(request, input))));
    }
    catch {
        valid = false;
    }
    if (!valid)
        return { status: 'invalid', reason: 'The HTTP message signature is invalid.' };
    try {
        if (!(await Store.tryClaim(options.nonceStore, `${options.nonceNamespace}:${input.keyId}:${input.nonce}`, input.expires * 1000)))
            return { status: 'invalid', reason: 'The signature nonce has already been used.' };
    }
    catch {
        return { status: 'unverified', reason: 'Replay protection is unavailable.' };
    }
    return { status: 'verified', input };
}
function parse(request, expectedTag) {
    const inputHeader = request.headers.get(AttestationHeaders.signatureInput);
    const signatureHeader = request.headers.get(AttestationHeaders.signature);
    if (!inputHeader && !signatureHeader)
        return undefined;
    if (!inputHeader || !signatureHeader)
        return { reason: 'Signature-Input and Signature must both be provided.' };
    let inputs;
    let signatures;
    try {
        inputs = parseDictionary(inputHeader);
        signatures = parseDictionary(signatureHeader);
    }
    catch {
        return { reason: 'The HTTP message signature is malformed.' };
    }
    if (!haveSameKeys(inputs, signatures))
        return { reason: 'Signature-Input and Signature do not contain the same labels.' };
    const tags = new Set(typeof expectedTag === 'string' ? [expectedTag] : expectedTag);
    for (const [label, entry] of inputs) {
        if (!hasExpectedTag(entry, tags))
            continue;
        const input = toSignatureInput(label, entry);
        if (!input)
            return { reason: 'The HTTP message signature is malformed.' };
        const signature = signatures.get(label);
        if (!signature || isInnerList(signature) || !(signature[0] instanceof ArrayBuffer))
            return { reason: 'No matching HTTP message signature was provided.' };
        return { input, signature: new Uint8Array(signature[0]) };
    }
    return undefined;
}
function serializeInput(input) {
    return serializeInnerList(toInnerList(input));
}
function toInnerList(input) {
    const components = input.components.map((component) => [
        component.id,
        new Map(component.parameters),
    ]);
    return [components, new Map(input.parameters)];
}
function toSignatureInput(label, entry) {
    const innerList = entry;
    if (!isInnerList(innerList))
        return undefined;
    const [componentEntries, parameters] = innerList;
    if (!componentEntries.length ||
        !componentEntries.every(([component]) => typeof component === 'string'))
        return undefined;
    const components = componentEntries.map(([id, parameters]) => ({
        id: id,
        parameters,
    }));
    const created = parameters.get('created');
    const expires = parameters.get('expires');
    const algorithm = parameters.get('alg');
    const keyId = parameters.get('keyid');
    const nonce = parameters.get('nonce');
    const tag = parameters.get('tag');
    if (!isInteger(created) ||
        !isInteger(expires) ||
        !isSignatureAlgorithm(algorithm) ||
        typeof keyId !== 'string' ||
        typeof nonce !== 'string' ||
        typeof tag !== 'string')
        return undefined;
    return {
        algorithm,
        components,
        created,
        expires,
        keyId,
        label,
        nonce,
        parameters,
        tag,
    };
}
function algorithmFromKey(key) {
    for (const algorithm of Object.values(Algorithms))
        if (keySupportsAlgorithm(key, algorithm))
            return algorithm;
    throw new TypeError('Request attestation requires an Ed25519 or RSA-PSS SHA-512 signing key.');
}
function isInteger(value) {
    return typeof value === 'number' && Number.isInteger(value);
}
function isSignatureAlgorithm(value) {
    return typeof value === 'string' && Object.hasOwn(algorithmDescriptors, value);
}
function keySupportsAlgorithm(key, algorithm) {
    const { hash, keyAlgorithm } = algorithmDescriptors[algorithm];
    return (key.algorithm.name === keyAlgorithm &&
        (!hash || key.algorithm.hash.name === hash));
}
function webCryptoAlgorithm(algorithm) {
    return algorithmDescriptors[algorithm].webCryptoAlgorithm;
}
function signatureBase(request, input) {
    const lines = input.components.map((component) => `${serializeComponent(component)}: ${componentValue(request, component)}`);
    lines.push(`"${Constants.components.signatureParams}": ${serializeInput(input)}`);
    return lines.join('\n');
}
function componentValue(request, component) {
    const url = new URL(request.url);
    if (component.id === Constants.components.authority) {
        if (component.parameters?.size)
            throw new Error('Unsupported parameters for "@authority".');
        return url.host;
    }
    if (component.id === Constants.components.path) {
        if (component.parameters?.size)
            throw new Error('Unsupported parameters for "@path".');
        return url.pathname;
    }
    if (component.parameters?.size)
        return componentDictionaryValue(request, component.id, component.parameters);
    const value = request.headers.get(component.id);
    if (value === null)
        throw new Error(`Missing signed HTTP header "${component.id}".`);
    // RFC 9421 signs the serialized field value, not a Unicode-normalized string.
    if (!/^[\x20-\x7e]*$/.test(value))
        throw new Error(`Signed HTTP header "${component.id}" is not ASCII.`);
    return value;
}
function componentDictionaryValue(request, component, parameters) {
    const key = parameters.get('key');
    if (typeof key !== 'string' || parameters.size !== 1)
        throw new Error(`Unsupported parameters for signed HTTP header "${component}".`);
    const value = request.headers.get(component);
    if (value === null)
        throw new Error(`Missing signed HTTP header "${component}".`);
    let dictionary;
    try {
        dictionary = parseDictionary(value);
    }
    catch {
        throw new Error(`Signed HTTP header "${component}" is not a structured dictionary.`);
    }
    const member = dictionary.get(key);
    if (!member || isInnerList(member))
        throw new Error(`Signed HTTP header "${component}" has no member "${key}".`);
    return serializeItem(member);
}
function hasComponent(components, expected) {
    return components.some((component) => component.id === expected);
}
function haveSameKeys(left, right) {
    return left.size === right.size && [...left.keys()].every((key) => right.has(key));
}
function hasExpectedTag(entry, tags) {
    const value = entry;
    if (!isInnerList(value))
        return false;
    const tag = value[1].get('tag');
    return typeof tag === 'string' && tags.has(tag);
}
function serializeComponent(component) {
    return `"${component.id}"${component.parameters?.size ? serializeParameters(new Map(component.parameters)) : ''}`;
}
function toComponent(component) {
    return typeof component === 'string'
        ? { id: component }
        : { id: component.id, parameters: component.parameters && new Map(component.parameters) };
}
function parseHeaderDictionary(headers, name) {
    const value = headers.get(name);
    if (!value)
        return new Map();
    try {
        return parseDictionary(value);
    }
    catch {
        throw new Error(`HTTP header "${name}" is not a structured dictionary.`);
    }
}
function encode(value) {
    return new TextEncoder().encode(value);
}
function toArrayBuffer(value) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
}
//# sourceMappingURL=HttpMessageSignature.js.map