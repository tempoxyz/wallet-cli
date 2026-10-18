import { stripePreviewVersion } from '../../internal/constants.js';
/** Creates a Stripe PaymentIntent using the SDK client. Handles Connect param mapping. */
export async function createPaymentIntent(client, params, options) {
    const connect = options?.connect;
    const fullParams = {
        ...params,
        ...(connect && {
            application_fee_amount: connect.applicationFeeAmount,
            on_behalf_of: connect.onBehalfOf,
            transfer_data: connect.transferData,
            transfer_group: connect.transferGroup,
        }),
    };
    const result = await client.paymentIntents.create(fullParams, {
        apiVersion: stripePreviewVersion,
        idempotencyKey: options?.idempotencyKey,
        stripeAccount: connect?.stripeAccount,
    });
    const replayed = result.lastResponse?.headers?.['idempotent-replayed'] === 'true';
    return { id: result.id, status: result.status, replayed };
}
/** Makes a raw Stripe API request using the SDK client. */
export async function stripeRequest(client, method, path, params, options) {
    return client.rawRequest(method, path, method === 'GET' ? undefined : params, {
        apiVersion: stripePreviewVersion,
        stripeAccount: options?.connect?.stripeAccount,
    });
}
//# sourceMappingURL=request.js.map