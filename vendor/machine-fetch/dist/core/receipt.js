/** Receipt for a payment asset that was already held. */
export function availableReceipt(network, asset, amount) {
    return Object.freeze({ status: 'available', network, asset, amount });
}
/** Receipt for an acquisition; `input.amount` appears only when actual spend was reported. */
export function acquiredReceipt(acquisition) {
    const { input, output } = acquisition;
    return Object.freeze({
        status: 'acquired',
        route: acquisition.route,
        input: Object.freeze({
            network: input.network,
            asset: input.asset,
            quotedAmount: input.quotedAmount,
            ...(input.amount !== undefined ? { amount: input.amount } : {}),
        }),
        output: Object.freeze({ network: output.network, asset: output.asset, amount: output.amount }),
        ...(acquisition.reference ? { reference: acquisition.reference } : {}),
    });
}
//# sourceMappingURL=receipt.js.map