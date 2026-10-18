/**
 * Stripe API version with `.preview` suffix.
 *
 * Required for `shared_payment_granted_token` (SPTs are in private preview).
 * Bump this when upgrading to a newer Stripe API version.
 */
export declare const stripePreviewVersion = "2026-07-29.preview";
/** Metadata identifying a Stripe PaymentIntent as a machine payment. */
export declare const machinePaymentMetadata: {
    readonly machine_payment: 'true';
};
//# sourceMappingURL=constants.d.ts.map