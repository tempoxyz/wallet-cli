import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { link, open, readFile, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { OperationStoreError } from '../core/errors.js';
import { checkReference, checkRelease, deserialize, guardStore, releasedReference, serialize, } from './serialization.js';
/**
 * Creates a persistent store in a private directory on a local POSIX filesystem supporting hard links.
 *
 * Each ID holds numbered generations of immutable files. A generation's single reference file holds
 * either its submission reference or a release marker, so publishing one excludes the other.
 * Releasing lets the next claim create a new generation; nothing is ever deleted, so no write can
 * race a removal. Generation 0 uses the original `<hash>.json` and `<hash>.reference` names, so
 * stores written by, and workers running, earlier versions contend for the same claims.
 */
export function fileStore(directory) {
    const root = resolve(directory);
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const path = (id, generation, suffix) => join(root, `${createHash('sha256').update(id).digest('hex')}${generation ? `.${generation}` : ''}.${suffix}`);
    /** The newest generation for an ID, with its raw record and reference file. */
    const latest = async (id) => {
        let found;
        for (let generation = 0;; generation++) {
            const record = await read(path(id, generation, 'json'));
            if (record === undefined)
                break;
            found = { generation, record };
        }
        if (!found)
            return undefined;
        return { ...found, reference: await read(path(id, found.generation, 'reference')) };
    };
    /** The newest generation's operation, unless it was released. */
    const live = async (id) => {
        const current = await latest(id);
        if (!current || current.reference === releasedReference)
            return undefined;
        const operation = deserialize(current.record, id);
        if (current.reference === undefined)
            return { generation: current.generation, operation };
        // Persisted references are validated like new ones, so corrupt recovery state fails closed.
        checkReference(operation, current.reference);
        return {
            generation: current.generation,
            operation: { ...operation, reference: current.reference },
        };
    };
    /** Publishes a generation's reference file; returns the value that won when another came first. */
    const settle = async (id, generation, value) => (await publish(root, path(id, generation, 'reference'), value))
        ? value
        : await read(path(id, generation, 'reference'));
    return guardStore({
        get: async (id) => (await live(id))?.operation,
        claim(operation) {
            // Snapshot before any read, so later caller mutations cannot reach the saved record.
            const id = operation.id;
            const record = serialize(operation);
            return (async () => {
                const current = await latest(id);
                if (current && current.reference !== releasedReference)
                    return false;
                const generation = current ? current.generation + 1 : 0;
                return publish(root, path(id, generation, 'json'), record);
            })();
        },
        async setReference(id, reference) {
            // Read the generation once, so a concurrent release and re-claim cannot redirect the write.
            const current = await live(id);
            if (!current)
                throw new OperationStoreError('Unknown operation');
            checkReference(current.operation, reference);
            const winner = await settle(id, current.generation, reference);
            if (winner === releasedReference)
                throw new OperationStoreError('Unknown operation');
            if (winner !== reference)
                throw new OperationStoreError('Conflicting operation reference');
        },
        async release(id) {
            const current = await live(id);
            if (!current)
                throw new OperationStoreError('Unknown operation');
            checkRelease(current.operation);
            if ((await settle(id, current.generation, releasedReference)) !== releasedReference)
                throw new OperationStoreError('Cannot release a submitted operation');
        },
    });
}
async function read(path) {
    try {
        return await readFile(path, 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return undefined;
        throw error;
    }
}
async function syncDirectory(directory) {
    const handle = await open(directory, 'r');
    try {
        await handle.sync();
    }
    finally {
        await handle.close();
    }
}
async function publish(directory, destination, value) {
    const temporary = join(directory, `${randomUUID()}.tmp`);
    const handle = await open(temporary, 'wx', 0o600);
    try {
        try {
            await handle.writeFile(value);
            await handle.sync();
        }
        finally {
            await handle.close();
        }
        try {
            // A complete immutable record becomes visible atomically, without overwriting a winner.
            await link(temporary, destination);
        }
        catch (error) {
            if (error.code !== 'EEXIST')
                throw error;
            await syncDirectory(directory);
            return false;
        }
        await syncDirectory(directory);
        return true;
    }
    finally {
        await unlink(temporary);
    }
}
//# sourceMappingURL=file.js.map