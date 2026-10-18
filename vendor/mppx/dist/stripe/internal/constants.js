/**
 * Stripe API version with `.preview` suffix.
 *
 * Required for `shared_payment_granted_token` (SPTs are in private preview).
 * Bump this when upgrading to a newer Stripe API version.
 */
export const stripePreviewVersion = '2026-07-29.preview';
/** Metadata identifying a Stripe PaymentIntent as a machine payment. */
export const machinePaymentMetadata = { machine_payment: 'true' };
//# sourceMappingURL=constants.js.map