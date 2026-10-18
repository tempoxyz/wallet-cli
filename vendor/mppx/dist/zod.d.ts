import { type ZodMiniType, z } from 'zod/mini';
export * from 'zod/mini';
export type DatetimeInput = string | Date;
/** Numeric string amount (e.g., "1", "1.5", "1000000"). */
export declare function amount(): z.ZodMiniString<string>;
/** ISO 8601 datetime string (e.g., "2025-01-06T12:00:00Z"). */
export declare function datetime(): z.ZodMiniString<string>;
/** ISO 8601 datetime string or Date object, transformed to a Date. */
export declare function datetimeInput(message?: string): z.ZodMiniPipe<z.ZodMiniUnion<readonly [z.ZodMiniString<string>, z.ZodMiniCustom<Date, Date>]>, z.ZodMiniTransform<Date, DatetimeInput>>;
/** Converts an ISO 8601 datetime string or Date object to a Date. */
export declare function toDate(value: DatetimeInput): Date;
/** Serializes an ISO 8601 datetime string or Date object for wire output. */
export declare function toDatetimeString(value: DatetimeInput): string;
/** Hex-encoded address string (0x-prefixed, 40 hex chars). */
export declare function address(): z.ZodMiniString<string>;
/** Hex-encoded hash string (0x-prefixed, 64 hex chars). */
export declare function hash(): z.ZodMiniString<string>;
/** Billing period: "day", "week", "month", "year", or seconds as string. */
export declare function period(): z.ZodMiniString<string>;
/** Hex-encoded signature string (0x-prefixed). */
export declare function signature(): z.ZodMiniString<string>;
/** Checks if a schema is optional and returns the inner type if so. */
export declare function unwrapOptional<schema extends ZodMiniType>(schema: schema): ZodMiniType;
//# sourceMappingURL=zod.d.ts.map