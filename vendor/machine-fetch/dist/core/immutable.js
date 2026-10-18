/** Copies and freezes plain data while leaving opaque runtime values intact. */
export function immutableSnapshot(input) {
    return snapshot(input, new WeakMap());
}
function snapshot(input, seen) {
    if (!isPlainData(input))
        return input;
    const existing = seen.get(input);
    if (existing)
        return existing;
    // Arrays keep their length and holes; like objects, only enumerable data properties are copied,
    // so accessors never run.
    const copy = (Array.isArray(input) ? new Array(input.length) : Object.create(Object.getPrototypeOf(input)));
    seen.set(input, copy);
    const descriptors = Object.getOwnPropertyDescriptors(input);
    for (const key of Reflect.ownKeys(descriptors)) {
        const descriptor = descriptors[key];
        if (descriptor.enumerable && 'value' in descriptor)
            Object.defineProperty(copy, key, {
                enumerable: true,
                value: snapshot(descriptor.value, seen),
            });
    }
    return Object.freeze(copy);
}
function isPlainData(value) {
    if (value === null || typeof value !== 'object')
        return false;
    if (Array.isArray(value))
        return true;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
//# sourceMappingURL=immutable.js.map