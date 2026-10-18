import * as Credential from '../../Credential.js';
/** Parsed MCP credential and its canonical HTTP Authorization value. */
export type Parsed = {
    header: string;
    value: Credential.Credential;
};
/** Validates an MCP metadata credential through the canonical wire serializer. */
export declare function parse(value: unknown): Parsed | undefined;
//# sourceMappingURL=Credential.d.ts.map