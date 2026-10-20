/**
 * The base error, shared configuration and store errors, and the union of every error
 * machine-fetch raises. Policy and funding errors live in {@link Policy} and {@link Funder}.
 * @module
 */
export type { BaseErrorType, GlobalErrorType, InvalidConfigurationErrorType, MachineFetchErrorOptions as Options, MachineFetchErrorType as ErrorType, OperationStoreErrorType, } from '../core/errors.js';
export { InvalidConfigurationError, MachineFetchError as BaseError, OperationStoreError, } from '../core/errors.js';
