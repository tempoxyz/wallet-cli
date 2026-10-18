export type ValidationError = {
    message: string;
    path: string;
    severity: 'error' | 'warning';
};
/**
 * Validates a discovery document structurally and semantically.
 */
export declare function validate(doc: unknown): ValidationError[];
//# sourceMappingURL=Validate.d.ts.map