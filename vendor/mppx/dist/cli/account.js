import * as child from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Errors } from 'incur';
import { isTempoAccount } from './utils.js';
const SERVICE_NAME = 'mppx';
const defaultCommandTimeoutMs = 10_000;
function commandTimeoutMs() {
    const value = Number.parseInt(process.env.MPPX_KEYCHAIN_COMMAND_TIMEOUT_MS ?? '', 10);
    return Number.isFinite(value) && value > 0 ? value : defaultCommandTimeoutMs;
}
function isMissingCommand(error, command) {
    return 'code' in error && error.code === 'ENOENT' && error.message.includes(command);
}
function keyringUnavailableError(cause) {
    return new Errors.IncurError({
        code: 'KEYCHAIN_UNAVAILABLE',
        message: 'Linux keyring requires secret-tool. Install libsecret-tools.',
        hint: 'On Debian/Ubuntu, run: sudo apt install libsecret-tools gnome-keyring dbus-x11',
        exitCode: 69,
        cause,
    });
}
function assertSecretToolAvailable(error) {
    if (error && isMissingCommand(error, 'secret-tool'))
        throw keyringUnavailableError(error);
}
export function execCommand(command, args) {
    return new Promise((resolve) => {
        child.execFile(command, args, { timeout: commandTimeoutMs() }, (error, stdout, stderr) => {
            resolve({ stdout: stdout.trim(), stderr: stderr.trim(), error });
        });
    });
}
export function createDefaultStore() {
    const configPath = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'mppx', 'default');
    return {
        get() {
            try {
                return fs.readFileSync(configPath, 'utf-8').trim() || 'main';
            }
            catch {
                return 'main';
            }
        },
        set(value) {
            fs.mkdirSync(path.dirname(configPath), { recursive: true });
            fs.writeFileSync(configPath, value, 'utf-8');
        },
        clear() {
            try {
                fs.unlinkSync(configPath);
            }
            catch { }
        },
    };
}
export function resolveAccountName(explicit) {
    if (explicit)
        return explicit;
    if (process.env.MPPX_ACCOUNT?.trim())
        return process.env.MPPX_ACCOUNT;
    return createDefaultStore().get();
}
// biome-ignore format: compact shell commands
export function createKeychain(account = 'main') {
    const service = SERVICE_NAME;
    return {
        async list() {
            const platform = os.platform();
            if (platform === 'darwin') {
                const { stdout, error } = await execCommand('security', ['dump-keychain']);
                if (error)
                    return [];
                const accounts = [];
                const blocks = stdout.split('keychain:');
                for (const block of blocks) {
                    const serviceMatch = block.match(/"svce"<blob>="([^"]*)"/);
                    const accountMatch = block.match(/"acct"<blob>="([^"]*)"/);
                    if (serviceMatch?.[1] === service && accountMatch?.[1])
                        accounts.push(accountMatch[1]);
                }
                return accounts;
            }
            if (platform === 'linux') {
                const { stdout, stderr, error } = await execCommand('secret-tool', [
                    'search',
                    '--all',
                    '--unlock',
                    'service',
                    service,
                ]);
                assertSecretToolAvailable(error);
                if (error)
                    return [];
                const combined = `${stdout}\n${stderr}`;
                const accounts = [];
                const matches = combined.matchAll(/\baccount = (.+)/g);
                for (const match of matches)
                    if (match[1])
                        accounts.push(match[1]);
                return accounts;
            }
            throw new Error(`Unsupported platform: ${platform}`);
        },
        async get() {
            const platform = os.platform();
            if (platform === 'darwin') {
                const { stdout, error } = await execCommand('security', [
                    'find-generic-password',
                    '-s',
                    service,
                    '-a',
                    account,
                    '-w',
                ]);
                return error ? undefined : stdout;
            }
            if (platform === 'linux') {
                const { stdout, error } = await execCommand('secret-tool', [
                    'lookup',
                    'service',
                    service,
                    'account',
                    account,
                ]);
                assertSecretToolAvailable(error);
                return error ? undefined : stdout || undefined;
            }
            throw new Error(`Unsupported platform: ${platform}`);
        },
        async set(value) {
            const platform = os.platform();
            if (platform === 'darwin') {
                await execCommand('security', ['delete-generic-password', '-s', service, '-a', account]);
                const { error } = await execCommand('security', [
                    'add-generic-password',
                    '-s',
                    service,
                    '-a',
                    account,
                    '-w',
                    value,
                ]);
                if (error)
                    throw error;
                return;
            }
            if (platform === 'linux') {
                const proc = child.execFile('secret-tool', [
                    'store',
                    '--label',
                    `${service} ${account}`,
                    'service',
                    service,
                    'account',
                    account,
                ]);
                const timeout = setTimeout(() => proc.kill(), commandTimeoutMs());
                proc.stdin?.write(value);
                proc.stdin?.end();
                return new Promise((resolve, reject) => {
                    proc.on('close', (code) => {
                        clearTimeout(timeout);
                        if (code === 0)
                            resolve();
                        else
                            reject(new Error(`secret-tool exited with code ${code}`));
                    });
                    proc.on('error', (error) => {
                        clearTimeout(timeout);
                        reject(isMissingCommand(error, 'secret-tool') ? keyringUnavailableError(error) : error);
                    });
                });
            }
            throw new Error(`Unsupported platform: ${platform}`);
        },
        async delete() {
            const platform = os.platform();
            if (platform === 'darwin') {
                await execCommand('security', ['delete-generic-password', '-s', service, '-a', account]);
                return;
            }
            if (platform === 'linux') {
                const { error } = await execCommand('secret-tool', [
                    'clear',
                    'service',
                    service,
                    'account',
                    account,
                ]);
                assertSecretToolAvailable(error);
                return;
            }
            throw new Error(`Unsupported platform: ${platform}`);
        },
    };
}
/** Resolves a local CLI signer together with its durable account reference. */
export async function resolveLocalAccount(name) {
    const { privateKeyToAccount } = await import('viem/accounts');
    const envKey = process.env.MPPX_PRIVATE_KEY?.trim();
    if (envKey)
        return {
            account: privateKeyToAccount(envKey),
            source: 'environment',
        };
    const accountName = resolveAccountName(name);
    const key = await createKeychain(accountName).get();
    if (key)
        return {
            account: privateKeyToAccount(key),
            accountName,
            source: 'keychain',
        };
    throw new Error(`Account "${accountName}" not found.`);
}
/** Resolves an account supported by persistent CLI sessions. */
export async function resolvePersistentAccount(name) {
    const accountName = resolveAccountName(name);
    if (!process.env.MPPX_PRIVATE_KEY?.trim() && isTempoAccount(accountName))
        throw new Errors.IncurError({
            code: 'UNSUPPORTED_ACCOUNT',
            message: 'Persistent sessions require an mppx account or MPPX_PRIVATE_KEY.',
            exitCode: 2,
        });
    return resolveLocalAccount(name).catch((cause) => {
        throw new Errors.IncurError({
            code: 'ACCOUNT_NOT_FOUND',
            message: cause instanceof Error ? cause.message : 'No account found.',
            exitCode: 69,
            ...(cause instanceof Error && { cause }),
        });
    });
}
/**
 * Resolve a CLI account to a viem `LocalAccount`.
 *
 * Resolution order:
 * 1. `MPPX_PRIVATE_KEY` environment variable
 * 2. OS keychain lookup for the named account
 *
 * @example
 * ```ts
 * import { resolveAccount } from 'mppx/cli'
 * import { tempo } from 'mppx/client'
 *
 * export default defineConfig({
 *   methods: [tempo({ account: await resolveAccount() })],
 * })
 * ```
 */
export async function resolveAccount(name) {
    return (await resolveLocalAccount(name)).account;
}
//# sourceMappingURL=account.js.map