import { Json } from 'ox';
import { attrs, ids, vars, } from './server/internal/html/config.js';
import { submitCredential } from './server/internal/html/serviceWorker.client.js';
export function init(methodName) {
    const element = document.getElementById(ids.data);
    const dataMap = Json.parse(element.textContent);
    const remaining = element.getAttribute(attrs.remaining);
    if (!remaining || Number(remaining) <= 1)
        element.remove();
    else
        element.setAttribute(attrs.remaining, String(Number(remaining) - 1));
    const script = document.currentScript;
    const challengeId = script?.getAttribute(attrs.challengeId);
    const data = challengeId
        ? (script.removeAttribute(attrs.challengeId), dataMap[challengeId])
        : Object.values(dataMap).find((d) => d.challenge.method === methodName);
    return {
        ...data,
        error(message) {
            if (!message) {
                document.getElementById(ids.error)?.remove();
                return;
            }
            const existing = document.getElementById(ids.error);
            if (existing) {
                existing.textContent = message;
                return;
            }
            const el = document.createElement('p');
            el.id = ids.error;
            el.className = 'mppx-error';
            el.role = 'alert';
            el.textContent = message;
            document.getElementById(data.rootId)?.after(el);
        },
        root: document.getElementById(data.rootId),
        submit: (credential) => submitCredential(credential, data.challenge.header),
        vars,
    };
}
//# sourceMappingURL=Html.js.map