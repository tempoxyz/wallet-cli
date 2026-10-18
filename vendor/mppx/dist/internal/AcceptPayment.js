import * as x402_ChallengeBrand from '../x402/internal/ChallengeBrand.js';
/** Builds the typed key tree used by callback-style preference config. */
export function buildKeys(methods) {
    const keys = {};
    for (const method of methods) {
        const group = (keys[method.name] ??= {});
        group[method.intent] = keyOf(method);
    }
    return keys;
}
/** Resolves configured payment preferences into a header string and parsed entries. */
export function resolve(methods, config) {
    const keys = buildKeys(methods);
    const definition = resolveDefinition(methods, keys, config);
    const entries = methods.map((method, index) => ({
        intent: method.intent,
        method: method.name,
        q: definition[keyOf(method)] ?? 1,
        index,
    }));
    return {
        definition,
        entries,
        header: serialize(entries),
        keys,
    };
}
/** Parses an `Accept-Payment` header into normalized preference entries. */
export function parse(header) {
    const parts = header
        .split(/\s*,\s*/)
        .map((part) => part.trim())
        .filter(Boolean);
    if (parts.length === 0)
        throw new Error('Accept-Payment header is empty.');
    return parts.map((part, index) => parseEntry(part, index));
}
/** Serializes preference entries to an `Accept-Payment` header value. */
export function serialize(entries) {
    return entries
        .map(({ method, intent, q }) => {
        const value = `${method}/${intent}`;
        return q === 1 ? value : `${value};q=${formatQ(q)}`;
    })
        .join(', ');
}
/**
 * Orders offered payment methods by the best matching client preference.
 *
 * More specific matches win before comparing q-values, so an explicit opt-out
 * like `tempo/charge;q=0` overrides a broader wildcard such as `tempo/*;q=1`.
 */
export function rank(offers, preferences) {
    return offers
        .map((offer, index) => {
        const match = bestMatch(offer, preferences);
        return match && match.q > 0 ? { match, offer, index } : undefined;
    })
        .filter((candidate) => Boolean(candidate))
        .sort((left, right) => right.match.q - left.match.q || left.index - right.index)
        .map(({ offer }) => offer);
}
/** Selects the best supported challenge from a set of server offers. */
export function selectChallenge(challenges, methods, preferences) {
    const candidate = selectChallengeCandidates(challenges, methods, preferences)[0];
    if (!candidate)
        return undefined;
    return {
        challenge: candidate.challenge,
        method: candidate.method,
    };
}
/** Returns supported challenge candidates ordered by client payment preferences. */
export function selectChallengeCandidates(challenges, methods, preferences) {
    const methodsByKey = new Map();
    for (const method of methods) {
        const key = keyOf(method);
        const matchingMethods = methodsByKey.get(key);
        if (matchingMethods)
            matchingMethods.push(method);
        else
            methodsByKey.set(key, [method]);
    }
    return challenges
        .flatMap((challenge, index) => {
        const matchingMethods = methodsByKey.get(keyOf(challenge));
        if (!matchingMethods)
            return [];
        const match = bestMatch(challenge, preferences);
        if (!match || match.q <= 0)
            return [];
        return matchingMethods
            .filter((method) => method.canHandleChallenge?.({ challenge }) ?? true)
            .map((method) => ({
            challenge,
            index,
            match,
            method,
        }));
    })
        .sort((left, right) => protocolRank(left.challenge) - protocolRank(right.challenge) ||
        right.match.q - left.match.q ||
        left.index - right.index)
        .map((candidate) => {
        const { match: _match, ...rest } = candidate;
        return rest;
    });
}
/** Returns the canonical `method/intent` key for a method or challenge-like value. */
export function keyOf(value) {
    const method = value.method ?? value.name;
    if (!method)
        throw new Error('Missing payment method name.');
    return `${method}/${value.intent}`;
}
function bestMatch(offer, preferences) {
    let best;
    for (const preference of preferences) {
        if (!matches(offer, preference))
            continue;
        const candidate = { ...preference, specificity: specificity(preference) };
        if (!best ||
            candidate.specificity > best.specificity ||
            (candidate.specificity === best.specificity && candidate.q > best.q) ||
            (candidate.specificity === best.specificity &&
                candidate.q === best.q &&
                candidate.index < best.index)) {
            best = candidate;
        }
    }
    return best;
}
function matches(offer, preference) {
    return ((preference.method === '*' || preference.method === offer.method) &&
        (preference.intent === '*' || preference.intent === offer.intent));
}
function specificity(preference) {
    return Number(preference.method !== '*') + Number(preference.intent !== '*');
}
function protocolRank(challenge) {
    return x402_ChallengeBrand.is(challenge) ? 1 : 0;
}
function parseEntry(part, index) {
    const match = /^(?<method>[^/;\s]+|\*)\s*\/\s*(?<intent>[^/;\s]+|\*)(?<params>(?:\s*;\s*.+)?)$/u.exec(part);
    const method = match?.groups?.method;
    const intent = match?.groups?.intent;
    if (!method || !intent) {
        throw new Error(`Invalid Accept-Payment entry: ${part}`);
    }
    assertToken(method, 'method');
    assertToken(intent, 'intent');
    let q = 1;
    for (const param of splitParameters(match.groups?.params)) {
        if (!param)
            continue;
        const parameterMatch = /^(?<name>[A-Za-z0-9_-]+)\s*=\s*(?<value>\S+)$/u.exec(param);
        const name = parameterMatch?.groups?.name;
        const rawValue = parameterMatch?.groups?.value;
        if (!name || !rawValue) {
            throw new Error(`Invalid Accept-Payment parameter: ${param}`);
        }
        if (name !== 'q')
            continue;
        q = parseHeaderQ(rawValue, `Accept-Payment entry "${part}"`);
    }
    return { intent, method, q, index };
}
function splitParameters(value) {
    return value ? value.split(/\s*;\s*/).filter(Boolean) : [];
}
function resolveDefinition(methods, keys, config) {
    if (!config)
        return {};
    const raw = typeof config === 'function' ? config(keys) : config;
    const allowed = new Set(methods.map((method) => keyOf(method)));
    const normalized = {};
    for (const [key, value] of Object.entries(raw ?? {})) {
        if (!allowed.has(key)) {
            throw new Error(`Unknown payment preference "${key}". Available: ${[...allowed].join(', ')}`);
        }
        normalized[key] = parseQ(value, `payment preference "${key}"`);
    }
    return normalized;
}
function parseQ(value, context) {
    if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
        throw new Error(`Invalid q-value for ${context}. Expected a finite number.`);
    }
    return assertQ(value, context);
}
function parseHeaderQ(value, context) {
    if (!/^0(?:\.\d{0,3})?$|^1(?:\.0{0,3})?$/.test(value)) {
        throw new Error(`Invalid q-value for ${context}. Expected an HTTP qvalue.`);
    }
    return assertQ(Number(value), context);
}
function assertQ(value, context) {
    if (value < 0 || value > 1) {
        throw new Error(`Invalid q-value for ${context}. Expected a value between 0 and 1.`);
    }
    const rounded = Math.round(value * 1000);
    if (Math.abs(value * 1000 - rounded) > 1e-9) {
        throw new Error(`Invalid q-value for ${context}. Expected at most 3 decimal places.`);
    }
    return rounded / 1000;
}
function formatQ(value) {
    return value
        .toFixed(3)
        .replace(/\.0+$/, '')
        .replace(/(\.\d*?)0+$/, '$1');
}
function assertToken(value, label) {
    if (value !== '*' && !/^[a-z0-9-]+$/.test(value)) {
        throw new Error(`Invalid Accept-Payment ${label}: ${value}`);
    }
}
//# sourceMappingURL=AcceptPayment.js.map