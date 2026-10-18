import { params } from './constants.js';
export async function submitCredential(credential, header = 'Authorization') {
    const url = new URL(location.href);
    url.searchParams.set(params.serviceWorker, '');
    const registration = await navigator.serviceWorker.register(url.pathname + url.search);
    const serviceWorker = await new Promise((resolve) => {
        const mppxWorker = registration.installing ?? registration.waiting ?? registration.active;
        if (mppxWorker?.state === 'activated')
            return resolve(mppxWorker);
        const target = mppxWorker ?? registration;
        target.addEventListener('statechange', function handler() {
            const active = registration.active;
            if (active?.state === 'activated') {
                target.removeEventListener('statechange', handler);
                resolve(active);
            }
        });
    });
    await new Promise((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => resolve();
        serviceWorker.postMessage({ credential, header }, [channel.port2]);
    });
    location.reload();
}
//# sourceMappingURL=serviceWorker.client.js.map