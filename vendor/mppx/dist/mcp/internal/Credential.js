import * as Credential from '../../Credential.js';
/** Validates an MCP metadata credential through the canonical wire serializer. */
export function parse(value) {
    if (!value || typeof value !== 'object')
        return undefined;
    if (!('challenge' in value) || !('payload' in value))
        return undefined;
    try {
        const header = Credential.serialize(value);
        return { header, value: Credential.deserialize(header) };
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=Credential.js.map