import { commitReservedCharges, reserveChargeOrWait } from './Transports.js';
/** Applies voucher reservation and spend commits to an async session stream. */
export async function* meterIterable(options) {
    let prepaidUnits = options.prepaidUnits ?? 0;
    let reservedAmount = 0n;
    let reservedUnits = 0;
    const charge = async (amount) => {
        if (amount === undefined && prepaidUnits > 0) {
            prepaidUnits -= 1;
            return;
        }
        const resolvedAmount = amount ?? options.tickCost;
        await reserveChargeOrWait({
            store: options.store,
            channelId: options.channelId,
            amount: resolvedAmount,
            reservedAmount,
            emit: options.emitNeedVoucher,
            formatNeedVoucher: options.formatNeedVoucher,
            pollIntervalMs: options.pollIntervalMs,
            signal: options.signal,
        });
        reservedAmount += resolvedAmount;
        reservedUnits += 1;
    };
    const signal = options.signal ?? new AbortController().signal;
    const iterable = typeof options.generate === 'function' ? options.generate({ charge, signal }) : options.generate;
    for await (const value of iterable) {
        if (options.signal?.aborted)
            break;
        if (typeof options.generate !== 'function')
            await charge();
        const channel = await commitReservedCharges({
            store: options.store,
            channelId: options.channelId,
            amount: reservedAmount,
            units: reservedUnits,
        });
        reservedAmount = 0n;
        reservedUnits = 0;
        if (channel)
            await options.onChargeCommitted?.(channel);
        yield value;
    }
}
//# sourceMappingURL=MeteredStream.js.map