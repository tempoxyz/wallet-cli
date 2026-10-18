import * as z from '../zod.js';
/**
 * Schema for the `x-payment-info` OpenAPI extension on an operation.
 *
 * Only validates spec-defined fields when present; unknown fields are ignored.
 * Discovery is advisory only. Runtime 402 challenges remain authoritative.
 */
export declare const PaymentInfo: z.ZodMiniPipe<z.ZodMiniObject<{
    amount: z.ZodMiniOptional<z.ZodMiniUnion<readonly [z.ZodMiniNull, z.ZodMiniString<string>]>>;
    currency: z.ZodMiniOptional<z.ZodMiniString<string>>;
    description: z.ZodMiniOptional<z.ZodMiniString<string>>;
    intent: z.ZodMiniOptional<z.ZodMiniString<string>>;
    method: z.ZodMiniOptional<z.ZodMiniString<string>>;
    offers: z.ZodMiniOptional<z.ZodMiniArray<z.ZodMiniObject<{
        amount: z.ZodMiniOptional<z.ZodMiniUnion<readonly [z.ZodMiniNull, z.ZodMiniString<string>]>>;
        currency: z.ZodMiniOptional<z.ZodMiniString<string>>;
        description: z.ZodMiniOptional<z.ZodMiniString<string>>;
        intent: z.ZodMiniOptional<z.ZodMiniString<string>>;
        method: z.ZodMiniOptional<z.ZodMiniString<string>>;
    }, z.core.$loose>>>;
}, z.core.$loose>, z.ZodMiniTransform<{
    offers: Record<string, unknown>[];
}, {
    [x: string]: unknown;
    amount?: string | null | undefined;
    currency?: string | undefined;
    description?: string | undefined;
    intent?: string | undefined;
    method?: string | undefined;
    offers?: {
        [x: string]: unknown;
        amount?: string | null | undefined;
        currency?: string | undefined;
        description?: string | undefined;
        intent?: string | undefined;
        method?: string | undefined;
    }[] | undefined;
}>>;
export type PaymentInfo = z.infer<typeof PaymentInfo>;
/**
 * Schema for the `x-service-info` OpenAPI extension at the document root.
 */
export declare const ServiceInfo: z.ZodMiniObject<{
    categories: z.ZodMiniOptional<z.ZodMiniArray<z.ZodMiniString<string>>>;
    docs: z.ZodMiniOptional<z.ZodMiniObject<{
        apiReference: z.ZodMiniOptional<z.ZodMiniString<string>>;
        homepage: z.ZodMiniOptional<z.ZodMiniString<string>>;
        llms: z.ZodMiniOptional<z.ZodMiniString<string>>;
    }, z.core.$loose>>;
}, z.core.$loose>;
export type ServiceInfo = z.infer<typeof ServiceInfo>;
/**
 * Minimal schema for an OpenAPI discovery document annotated with
 * `x-service-info` and per-operation `x-payment-info`.
 */
export declare const DiscoveryDocument: z.ZodMiniObject<{
    openapi: z.ZodMiniString<string>;
    info: z.ZodMiniObject<{
        title: z.ZodMiniString<string>;
        version: z.ZodMiniString<string>;
    }, z.core.$loose>;
    'x-service-info': z.ZodMiniOptional<z.ZodMiniObject<{
        categories: z.ZodMiniOptional<z.ZodMiniArray<z.ZodMiniString<string>>>;
        docs: z.ZodMiniOptional<z.ZodMiniObject<{
            apiReference: z.ZodMiniOptional<z.ZodMiniString<string>>;
            homepage: z.ZodMiniOptional<z.ZodMiniString<string>>;
            llms: z.ZodMiniOptional<z.ZodMiniString<string>>;
        }, z.core.$loose>>;
    }, z.core.$loose>>;
    paths: z.ZodMiniOptional<z.ZodMiniRecord<z.ZodMiniString<string>, z.ZodMiniObject<{
        delete: z.ZodMiniOptional<z.ZodMiniObject<{
            'x-payment-info': z.ZodMiniOptional<z.ZodMiniPipe<z.ZodMiniObject<{
                amount: z.ZodMiniOptional<z.ZodMiniUnion<readonly [z.ZodMiniNull, z.ZodMiniString<string>]>>;
                currency: z.ZodMiniOptional<z.ZodMiniString<string>>;
                description: z.ZodMiniOptional<z.ZodMiniString<string>>;
                intent: z.ZodMiniOptional<z.ZodMiniString<string>>;
                method: z.ZodMiniOptional<z.ZodMiniString<string>>;
                offers: z.ZodMiniOptional<z.ZodMiniArray<z.ZodMiniObject<{
                    amount: z.ZodMiniOptional<z.ZodMiniUnion<readonly [z.ZodMiniNull, z.ZodMiniString<string>]>>;
                    currency: z.ZodMiniOptional<z.ZodMiniString<string>>;
                    description: z.ZodMiniOptional<z.ZodMiniString<string>>;
                    intent: z.ZodMiniOptional<z.ZodMiniString<string>>;
                    method: z.ZodMiniOptional<z.ZodMiniString<string>>;
                }, z.core.$loose>>>;
            }, z.core.$loose>, z.ZodMiniTransform<{
                offers: Record<string, unknown>[];
            }, {
                [x: string]: unknown;
                amount?: string | null | undefined;
                currency?: string | undefined;
                description?: string | undefined;
                intent?: string | undefined;
                method?: string | undefined;
                offers?: {
                    [x: string]: unknown;
                    amount?: string | null | undefined;
                    currency?: string | undefined;
                    description?: string | undefined;
                    intent?: string | undefined;
                    method?: string | undefined;
                }[] | undefined;
            }>>>;
            requestBody: z.ZodMiniOptional<z.ZodMiniUnknown>;
            responses: z.ZodMiniOptional<z.ZodMiniRecord<z.ZodMiniString<string>, z.ZodMiniUnknown>>;
            summary: z.ZodMiniOptional<z.ZodMiniString<string>>;
        }, z.core.$loose>>;
        get: z.ZodMiniOptional<z.ZodMiniObject<{
            'x-payment-info': z.ZodMiniOptional<z.ZodMiniPipe<z.ZodMiniObject<{
                amount: z.ZodMiniOptional<z.ZodMiniUnion<readonly [z.ZodMiniNull, z.ZodMiniString<string>]>>;
                currency: z.ZodMiniOptional<z.ZodMiniString<string>>;
                description: z.ZodMiniOptional<z.ZodMiniString<string>>;
                intent: z.ZodMiniOptional<z.ZodMiniString<string>>;
                method: z.ZodMiniOptional<z.ZodMiniString<string>>;
                offers: z.ZodMiniOptional<z.ZodMiniArray<z.ZodMiniObject<{
                    amount: z.ZodMiniOptional<z.ZodMiniUnion<readonly [z.ZodMiniNull, z.ZodMiniString<string>]>>;
                    currency: z.ZodMiniOptional<z.ZodMiniString<string>>;
                    description: z.ZodMiniOptional<z.ZodMiniString<string>>;
                    intent: z.ZodMiniOptional<z.ZodMiniString<string>>;
                    method: z.ZodMiniOptional<z.ZodMiniString<string>>;
                }, z.core.$loose>>>;
            }, z.core.$loose>, z.ZodMiniTransform<{
                offers: Record<string, unknown>[];
            }, {
                [x: string]: unknown;
                amount?: string | null | undefined;
                currency?: string | undefined;
                description?: string | undefined;
                intent?: string | undefined;
                method?: string | undefined;
                offers?: {
                    [x: string]: unknown;
                    amount?: string | null | undefined;
                    currency?: string | undefined;
                    description?: string | undefined;
                    intent?: string | undefined;
                    method?: string | undefined;
                }[] | undefined;
            }>>>;
            requestBody: z.ZodMiniOptional<z.ZodMiniUnknown>;
            responses: z.ZodMiniOptional<z.ZodMiniRecord<z.ZodMiniString<string>, z.ZodMiniUnknown>>;
            summary: z.ZodMiniOptional<z.ZodMiniString<string>>;
        }, z.core.$loose>>;
        head: z.ZodMiniOptional<z.ZodMiniObject<{
            'x-payment-info': z.ZodMiniOptional<z.ZodMiniPipe<z.ZodMiniObject<{
                amount: z.ZodMiniOptional<z.ZodMiniUnion<readonly [z.ZodMiniNull, z.ZodMiniString<string>]>>;
                currency: z.ZodMiniOptional<z.ZodMiniString<string>>;
                description: z.ZodMiniOptional<z.ZodMiniString<string>>;
                intent: z.ZodMiniOptional<z.ZodMiniString<string>>;
                method: z.ZodMiniOptional<z.ZodMiniString<string>>;
                offers: z.ZodMiniOptional<z.ZodMiniArray<z.ZodMiniObject<{
                    amount: z.ZodMiniOptional<z.ZodMiniUnion<readonly [z.ZodMiniNull, z.ZodMiniString<string>]>>;
                    currency: z.ZodMiniOptional<z.ZodMiniString<string>>;
                    description: z.ZodMiniOptional<z.ZodMiniString<string>>;
                    intent: z.ZodMiniOptional<z.ZodMiniString<string>>;
                    method: z.ZodMiniOptional<z.ZodMiniString<string>>;
                }, z.core.$loose>>>;
            }, z.core.$loose>, z.ZodMiniTransform<{
                offers: Record<string, unknown>[];
            }, {
                [x: string]: unknown;
                amount?: string | null | undefined;
                currency?: string | undefined;
                description?: string | undefined;
                intent?: string | undefined;
                method?: string | undefined;
                offers?: {
                    [x: string]: unknown;
                    amount?: string | null | undefined;
                    currency?: string | undefined;
                    description?: string | undefined;
                    intent?: string | undefined;
                    method?: string | undefined;
                }[] | undefined;
            }>>>;
            requestBody: z.ZodMiniOptional<z.ZodMiniUnknown>;
            responses: z.ZodMiniOptional<z.ZodMiniRecord<z.ZodMiniString<string>, z.ZodMiniUnknown>>;
            summary: z.ZodMiniOptional<z.ZodMiniString<string>>;
        }, z.core.$loose>>;
        options: z.ZodMiniOptional<z.ZodMiniObject<{
            'x-payment-info': z.ZodMiniOptional<z.ZodMiniPipe<z.ZodMiniObject<{
                amount: z.ZodMiniOptional<z.ZodMiniUnion<readonly [z.ZodMiniNull, z.ZodMiniString<string>]>>;
                currency: z.ZodMiniOptional<z.ZodMiniString<string>>;
                description: z.ZodMiniOptional<z.ZodMiniString<string>>;
                intent: z.ZodMiniOptional<z.ZodMiniString<string>>;
                method: z.ZodMiniOptional<z.ZodMiniString<string>>;
                offers: z.ZodMiniOptional<z.ZodMiniArray<z.ZodMiniObject<{
                    amount: z.ZodMiniOptional<z.ZodMiniUnion<readonly [z.ZodMiniNull, z.ZodMiniString<string>]>>;
                    currency: z.ZodMiniOptional<z.ZodMiniString<string>>;
                    description: z.ZodMiniOptional<z.ZodMiniString<string>>;
                    intent: z.ZodMiniOptional<z.ZodMiniString<string>>;
                    method: z.ZodMiniOptional<z.ZodMiniString<string>>;
                }, z.core.$loose>>>;
            }, z.core.$loose>, z.ZodMiniTransform<{
                offers: Record<string, unknown>[];
            }, {
                [x: string]: unknown;
                amount?: string | null | undefined;
                currency?: string | undefined;
                description?: string | undefined;
                intent?: string | undefined;
                method?: string | undefined;
                offers?: {
                    [x: string]: unknown;
                    amount?: string | null | undefined;
                    currency?: string | undefined;
                    description?: string | undefined;
                    intent?: string | undefined;
                    method?: string | undefined;
                }[] | undefined;
            }>>>;
            requestBody: z.ZodMiniOptional<z.ZodMiniUnknown>;
            responses: z.ZodMiniOptional<z.ZodMiniRecord<z.ZodMiniString<string>, z.ZodMiniUnknown>>;
            summary: z.ZodMiniOptional<z.ZodMiniString<string>>;
        }, z.core.$loose>>;
        patch: z.ZodMiniOptional<z.ZodMiniObject<{
            'x-payment-info': z.ZodMiniOptional<z.ZodMiniPipe<z.ZodMiniObject<{
                amount: z.ZodMiniOptional<z.ZodMiniUnion<readonly [z.ZodMiniNull, z.ZodMiniString<string>]>>;
                currency: z.ZodMiniOptional<z.ZodMiniString<string>>;
                description: z.ZodMiniOptional<z.ZodMiniString<string>>;
                intent: z.ZodMiniOptional<z.ZodMiniString<string>>;
                method: z.ZodMiniOptional<z.ZodMiniString<string>>;
                offers: z.ZodMiniOptional<z.ZodMiniArray<z.ZodMiniObject<{
                    amount: z.ZodMiniOptional<z.ZodMiniUnion<readonly [z.ZodMiniNull, z.ZodMiniString<string>]>>;
                    currency: z.ZodMiniOptional<z.ZodMiniString<string>>;
                    description: z.ZodMiniOptional<z.ZodMiniString<string>>;
                    intent: z.ZodMiniOptional<z.ZodMiniString<string>>;
                    method: z.ZodMiniOptional<z.ZodMiniString<string>>;
                }, z.core.$loose>>>;
            }, z.core.$loose>, z.ZodMiniTransform<{
                offers: Record<string, unknown>[];
            }, {
                [x: string]: unknown;
                amount?: string | null | undefined;
                currency?: string | undefined;
                description?: string | undefined;
                intent?: string | undefined;
                method?: string | undefined;
                offers?: {
                    [x: string]: unknown;
                    amount?: string | null | undefined;
                    currency?: string | undefined;
                    description?: string | undefined;
                    intent?: string | undefined;
                    method?: string | undefined;
                }[] | undefined;
            }>>>;
            requestBody: z.ZodMiniOptional<z.ZodMiniUnknown>;
            responses: z.ZodMiniOptional<z.ZodMiniRecord<z.ZodMiniString<string>, z.ZodMiniUnknown>>;
            summary: z.ZodMiniOptional<z.ZodMiniString<string>>;
        }, z.core.$loose>>;
        post: z.ZodMiniOptional<z.ZodMiniObject<{
            'x-payment-info': z.ZodMiniOptional<z.ZodMiniPipe<z.ZodMiniObject<{
                amount: z.ZodMiniOptional<z.ZodMiniUnion<readonly [z.ZodMiniNull, z.ZodMiniString<string>]>>;
                currency: z.ZodMiniOptional<z.ZodMiniString<string>>;
                description: z.ZodMiniOptional<z.ZodMiniString<string>>;
                intent: z.ZodMiniOptional<z.ZodMiniString<string>>;
                method: z.ZodMiniOptional<z.ZodMiniString<string>>;
                offers: z.ZodMiniOptional<z.ZodMiniArray<z.ZodMiniObject<{
                    amount: z.ZodMiniOptional<z.ZodMiniUnion<readonly [z.ZodMiniNull, z.ZodMiniString<string>]>>;
                    currency: z.ZodMiniOptional<z.ZodMiniString<string>>;
                    description: z.ZodMiniOptional<z.ZodMiniString<string>>;
                    intent: z.ZodMiniOptional<z.ZodMiniString<string>>;
                    method: z.ZodMiniOptional<z.ZodMiniString<string>>;
                }, z.core.$loose>>>;
            }, z.core.$loose>, z.ZodMiniTransform<{
                offers: Record<string, unknown>[];
            }, {
                [x: string]: unknown;
                amount?: string | null | undefined;
                currency?: string | undefined;
                description?: string | undefined;
                intent?: string | undefined;
                method?: string | undefined;
                offers?: {
                    [x: string]: unknown;
                    amount?: string | null | undefined;
                    currency?: string | undefined;
                    description?: string | undefined;
                    intent?: string | undefined;
                    method?: string | undefined;
                }[] | undefined;
            }>>>;
            requestBody: z.ZodMiniOptional<z.ZodMiniUnknown>;
            responses: z.ZodMiniOptional<z.ZodMiniRecord<z.ZodMiniString<string>, z.ZodMiniUnknown>>;
            summary: z.ZodMiniOptional<z.ZodMiniString<string>>;
        }, z.core.$loose>>;
        put: z.ZodMiniOptional<z.ZodMiniObject<{
            'x-payment-info': z.ZodMiniOptional<z.ZodMiniPipe<z.ZodMiniObject<{
                amount: z.ZodMiniOptional<z.ZodMiniUnion<readonly [z.ZodMiniNull, z.ZodMiniString<string>]>>;
                currency: z.ZodMiniOptional<z.ZodMiniString<string>>;
                description: z.ZodMiniOptional<z.ZodMiniString<string>>;
                intent: z.ZodMiniOptional<z.ZodMiniString<string>>;
                method: z.ZodMiniOptional<z.ZodMiniString<string>>;
                offers: z.ZodMiniOptional<z.ZodMiniArray<z.ZodMiniObject<{
                    amount: z.ZodMiniOptional<z.ZodMiniUnion<readonly [z.ZodMiniNull, z.ZodMiniString<string>]>>;
                    currency: z.ZodMiniOptional<z.ZodMiniString<string>>;
                    description: z.ZodMiniOptional<z.ZodMiniString<string>>;
                    intent: z.ZodMiniOptional<z.ZodMiniString<string>>;
                    method: z.ZodMiniOptional<z.ZodMiniString<string>>;
                }, z.core.$loose>>>;
            }, z.core.$loose>, z.ZodMiniTransform<{
                offers: Record<string, unknown>[];
            }, {
                [x: string]: unknown;
                amount?: string | null | undefined;
                currency?: string | undefined;
                description?: string | undefined;
                intent?: string | undefined;
                method?: string | undefined;
                offers?: {
                    [x: string]: unknown;
                    amount?: string | null | undefined;
                    currency?: string | undefined;
                    description?: string | undefined;
                    intent?: string | undefined;
                    method?: string | undefined;
                }[] | undefined;
            }>>>;
            requestBody: z.ZodMiniOptional<z.ZodMiniUnknown>;
            responses: z.ZodMiniOptional<z.ZodMiniRecord<z.ZodMiniString<string>, z.ZodMiniUnknown>>;
            summary: z.ZodMiniOptional<z.ZodMiniString<string>>;
        }, z.core.$loose>>;
        trace: z.ZodMiniOptional<z.ZodMiniObject<{
            'x-payment-info': z.ZodMiniOptional<z.ZodMiniPipe<z.ZodMiniObject<{
                amount: z.ZodMiniOptional<z.ZodMiniUnion<readonly [z.ZodMiniNull, z.ZodMiniString<string>]>>;
                currency: z.ZodMiniOptional<z.ZodMiniString<string>>;
                description: z.ZodMiniOptional<z.ZodMiniString<string>>;
                intent: z.ZodMiniOptional<z.ZodMiniString<string>>;
                method: z.ZodMiniOptional<z.ZodMiniString<string>>;
                offers: z.ZodMiniOptional<z.ZodMiniArray<z.ZodMiniObject<{
                    amount: z.ZodMiniOptional<z.ZodMiniUnion<readonly [z.ZodMiniNull, z.ZodMiniString<string>]>>;
                    currency: z.ZodMiniOptional<z.ZodMiniString<string>>;
                    description: z.ZodMiniOptional<z.ZodMiniString<string>>;
                    intent: z.ZodMiniOptional<z.ZodMiniString<string>>;
                    method: z.ZodMiniOptional<z.ZodMiniString<string>>;
                }, z.core.$loose>>>;
            }, z.core.$loose>, z.ZodMiniTransform<{
                offers: Record<string, unknown>[];
            }, {
                [x: string]: unknown;
                amount?: string | null | undefined;
                currency?: string | undefined;
                description?: string | undefined;
                intent?: string | undefined;
                method?: string | undefined;
                offers?: {
                    [x: string]: unknown;
                    amount?: string | null | undefined;
                    currency?: string | undefined;
                    description?: string | undefined;
                    intent?: string | undefined;
                    method?: string | undefined;
                }[] | undefined;
            }>>>;
            requestBody: z.ZodMiniOptional<z.ZodMiniUnknown>;
            responses: z.ZodMiniOptional<z.ZodMiniRecord<z.ZodMiniString<string>, z.ZodMiniUnknown>>;
            summary: z.ZodMiniOptional<z.ZodMiniString<string>>;
        }, z.core.$loose>>;
    }, z.core.$loose>>>;
}, z.core.$loose>;
export type DiscoveryDocument = z.infer<typeof DiscoveryDocument>;
//# sourceMappingURL=Discovery.d.ts.map