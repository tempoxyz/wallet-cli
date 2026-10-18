function createSingleWaiter(name) {
    let waiter = null;
    return {
        wait(predicate = () => true) {
            if (waiter)
                throw new Error(`${name} wait already in progress`);
            return new Promise((resolve, reject) => {
                waiter = { predicate, resolve, reject };
            });
        },
        settle(value) {
            if (!waiter || !waiter.predicate(value))
                return;
            const current = waiter;
            waiter = null;
            current.resolve(value);
        },
        reject(error) {
            if (!waiter)
                return;
            const current = waiter;
            waiter = null;
            current.reject(error);
        },
    };
}
/** Creates the receipt coordinator used by HTTP/SSE/WebSocket session manager flows. */
export function createSessionReceiptCoordinator(parameters) {
    const closeReadyWaiter = createSingleWaiter('close-ready');
    const receiptWaiter = createSingleWaiter('receipt');
    return {
        waitForReceipt(predicate) {
            return receiptWaiter.wait(predicate);
        },
        waitForCloseReady() {
            const receipt = parameters.getSocketSession()?.closeReadyReceipt;
            if (receipt)
                return Promise.resolve(receipt);
            return closeReadyWaiter.wait();
        },
        settleReceipt(receipt) {
            receiptWaiter.settle(receipt);
        },
        settleCloseReady(receipt) {
            const socketSession = parameters.getSocketSession();
            if (socketSession &&
                socketSession.challenge.id === receipt.challengeId &&
                socketSession.channelId === receipt.channelId) {
                socketSession.closeReadyReceipt = receipt;
            }
            closeReadyWaiter.settle(receipt);
        },
        rejectReceipt(error) {
            receiptWaiter.reject(error);
        },
        rejectCloseReady(error) {
            closeReadyWaiter.reject(error);
        },
    };
}
//# sourceMappingURL=ReceiptCoordinator.js.map