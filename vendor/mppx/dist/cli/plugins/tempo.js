import * as child from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Errors, z } from 'incur';
import { Base64 } from 'ox';
import { createClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { Actions } from 'viem/tempo';
import { normalizeHeaders } from '../../client/internal/Fetch.js';
import * as Constants from '../../Constants.js';
import * as Credential from '../../Credential.js';
import { tempo as tempoMethods } from '../../tempo/client/index.js';
import { tip20ChannelEscrow } from '../../tempo/session/precompile/Protocol.js';
import { signVoucher } from '../../tempo/session/precompile/Voucher.js';
import { createDefaultStore, createKeychain, resolveAccountName } from '../account.js';
import { fetchTokenInfo, fmtBalance, isTempoAccount, isTestnet, link, pc, resolveChain, resolveRpcUrl, } from '../utils.js';
import { createPlugin } from './plugin.js';
const packageName = 'mppx';
const booleanOption = z.union([
    z.boolean(),
    z.literal('true').transform(() => true),
    z.literal('false').transform(() => false),
]);
async function writeResponseBody(response) {
    process.stdout.write(Buffer.from(await response.arrayBuffer()));
}
const tempoOptionSchema = z.object({
    allowCustomEscrow: z.optional(booleanOption),
    autoSwap: z.optional(booleanOption),
    channel: z.optional(z.coerce.string()),
    deposit: z.optional(z.union([z.string(), z.number()])),
    payWith: z.optional(z.string()),
    slippage: z.optional(z.coerce.number()),
    tokenIn: z.optional(z.string()),
});
const tempoOptionKeys = [
    'allowCustomEscrow',
    'autoSwap',
    'channel',
    'deposit',
    'payWith',
    'slippage',
    'tokenIn',
];
const tempoChargeChallengeScoreOrder = [
    'payable',
    'unknownBalance',
    'insufficientBalance',
    'unsupported',
];
/**
 * Orders Tempo charge challenges by whether the configured wallet can satisfy them.
 *
 * Direct balances are preferred first. Unsupported or unpayable challenges keep
 * their original relative order.
 */
export async function orderTempoChargeChallengesByBalance(challenges, ctx) {
    const tempoPositions = [];
    const tempoChallenges = [];
    for (const [index, challenge] of challenges.entries()) {
        if (!isTempoChargeChallenge(challenge))
            continue;
        tempoPositions.push(index);
        tempoChallenges.push(challenge);
    }
    if (tempoChallenges.length < 2)
        return [...challenges];
    const probe = await resolveBalanceProbe(ctx).catch(() => undefined);
    if (!probe)
        return [...challenges];
    const scored = await Promise.all(tempoChallenges.map(async (challenge, index) => ({
        challenge,
        index,
        score: await scoreTempoChargeChallenge(challenge, probe),
    })));
    scored.sort((left, right) => tempoChargeChallengeScoreOrder.indexOf(left.score) -
        tempoChargeChallengeScoreOrder.indexOf(right.score) || left.index - right.index);
    const ordered = [...challenges];
    for (const [index, position] of tempoPositions.entries()) {
        ordered[position] = scored[index].challenge;
    }
    return ordered;
}
export function tempo() {
    let _session;
    return createPlugin({
        method: 'tempo',
        supports(challenge) {
            return challenge.method === 'tempo' && ['charge', 'session'].includes(challenge.intent);
        },
        async setup({ challenge, options, methodOpts }) {
            const accountName = resolveAccountName(options.account);
            const challengeRequest = challenge.request;
            const currency = challengeRequest.currency;
            const tempoOpts = parseTempoOptions(methodOpts);
            const autoSwap = resolveAutoSwap({
                autoSwap: tempoOpts.autoSwap ?? options.autoSwap,
                payWith: tempoOpts.payWith ?? options.payWith,
                slippage: tempoOpts.slippage ?? options.slippage,
                tokenIn: tempoOpts.tokenIn,
            });
            let tokenSymbol = currency ?? '';
            let tokenDecimals = challengeRequest.decimals ?? 6;
            let explorerUrl;
            let account;
            let client;
            let useTempoCliSign = false;
            const privateKey = process.env.MPPX_PRIVATE_KEY?.trim() ||
                (isTempoAccount(accountName) ? undefined : await createKeychain(accountName).get());
            if (!privateKey && isTempoAccount(accountName) && hasTempoCliSync()) {
                useTempoCliSign = true;
                const tempoEntry = resolveTempoAccount(accountName);
                if (tempoEntry) {
                    const rpcUrl = resolveRpcUrl(options.rpcUrl, { network: options.network });
                    client = createClient({
                        chain: await resolveChain({ network: options.network, rpcUrl }),
                        transport: http(rpcUrl),
                    });
                    assertChallengeChain({ challenge, clientChainId: client.chain?.id });
                    explorerUrl = client.chain?.blockExplorers?.default?.url;
                    const tokenInfo = currency
                        ? await fetchTokenInfo(client, currency, tempoEntry.wallet_address).catch(() => undefined)
                        : undefined;
                    tokenSymbol = tokenInfo?.symbol ?? currency ?? '';
                    tokenDecimals =
                        tokenInfo?.decimals ?? challengeRequest.decimals ?? 6;
                }
            }
            else if (!privateKey) {
                const fallback = fallbackFromTempo();
                if (fallback) {
                    const fallbackKey = await createKeychain(fallback).get();
                    if (fallbackKey)
                        account = privateKeyToAccount(fallbackKey);
                }
                if (!account) {
                    if (options.account)
                        throw new Errors.IncurError({
                            code: 'ACCOUNT_NOT_FOUND',
                            message: `Account "${accountName}" not found.`,
                            exitCode: 69,
                        });
                    else
                        throw new Errors.IncurError({
                            code: 'ACCOUNT_NOT_FOUND',
                            message: 'No account found.',
                            exitCode: 69,
                        });
                }
            }
            else
                account = privateKeyToAccount(privateKey);
            if (!useTempoCliSign && account) {
                const rpcUrl = resolveRpcUrl(options.rpcUrl, { network: options.network });
                client = createClient({
                    chain: await resolveChain({ network: options.network, rpcUrl }),
                    transport: http(rpcUrl),
                });
                assertChallengeChain({ challenge, clientChainId: client.chain?.id });
                explorerUrl = client.chain?.blockExplorers?.default?.url;
                const tokenInfo = currency
                    ? await fetchTokenInfo(client, currency, account.address).catch(() => undefined)
                    : undefined;
                tokenSymbol = tokenInfo?.symbol ?? currency ?? '';
                tokenDecimals =
                    tokenInfo?.decimals ?? challengeRequest.decimals ?? 6;
            }
            if (useTempoCliSign)
                return {
                    tokenSymbol,
                    tokenDecimals,
                    explorerUrl,
                    methods: [],
                    async createCredential(response) {
                        const wwwAuth = response.headers.get('www-authenticate');
                        if (!wwwAuth)
                            throw new Error('No WWW-Authenticate header in 402 response.');
                        return tempoCliSign(wwwAuth);
                    },
                };
            if (!account || !client)
                throw new Errors.IncurError({
                    code: 'ACCOUNT_NOT_FOUND',
                    message: 'Tempo requires a configured account.',
                    exitCode: 69,
                });
            const methods = tempoMethods({
                account,
                ...(tempoOpts.allowCustomEscrow !== undefined
                    ? { allowCustomEscrow: tempoOpts.allowCustomEscrow }
                    : {}),
                getClient: () => client,
                ...(autoSwap !== undefined ? { autoSwap } : {}),
                maxDeposit: (() => {
                    if (challenge.intent !== 'session')
                        return undefined;
                    const suggestedDeposit = challenge.request
                        .suggestedDeposit;
                    const cliDeposit = tempoOpts.deposit !== undefined ? String(tempoOpts.deposit) : undefined;
                    const resolved = cliDeposit ?? suggestedDeposit ?? (isTestnet(client.chain) ? '10' : undefined);
                    if (!resolved) {
                        throw new Errors.IncurError({
                            code: 'MISSING_DEPOSIT',
                            message: 'Session payment requires a deposit. Use -M deposit=<amount> or connect to testnet.',
                            exitCode: 2,
                        });
                    }
                    return resolved;
                })(),
            });
            const credentialContext = (() => {
                if (!tempoOpts.channel)
                    return undefined;
                const channelId = tempoOpts.channel;
                const saved = readChannelCumulative(channelId);
                return {
                    channelId,
                    ...(saved !== undefined && { cumulativeAmountRaw: saved.toString() }),
                };
            })();
            const chainId = client.chain.id;
            // Store session support for use in lifecycle hooks
            _session = {
                descriptor: undefined,
                async signVoucher({ channelId, cumulativeAmount, escrowContract, chainId, action = 'voucher', }) {
                    const descriptor = _session?.descriptor;
                    if (!descriptor)
                        throw new Error('session descriptor not available');
                    return Credential.serialize({
                        challenge,
                        payload: {
                            action,
                            channelId,
                            descriptor,
                            cumulativeAmount: cumulativeAmount.toString(),
                            signature: await signVoucher(client, account, { channelId: channelId, cumulativeAmount }, escrowContract, chainId),
                        },
                        source: `did:pkh:eip155:${chainId}:${account.address}`,
                    });
                },
                source: `did:pkh:eip155:${chainId}:${account.address}`,
            };
            return {
                tokenSymbol,
                tokenDecimals,
                explorerUrl,
                methods: [...methods],
                credentialContext,
            };
        },
        prepareCredentialRequest({ challenge, headers }) {
            if (challenge.intent === 'session')
                headers.Accept = 'text/event-stream';
        },
        async handleResponse(ctx) {
            if (ctx.challenge.intent !== 'session')
                return false;
            if (!_session)
                return false;
            const { challenge, credential, response, fetchUrl, fetchInit, verbose } = ctx;
            const { silent, confirmEnabled, tokenSymbol, tokenDecimals, explorerUrl, shownKeys } = ctx;
            const info = silent ? (_msg) => { } : (msg) => process.stderr.write(msg);
            const parsed = Credential.deserialize(credential);
            const challengeRequest = challenge.request;
            const sessionMd = challengeRequest.methodDetails;
            const channelId = parsed.payload.channelId;
            const escrowContract = (sessionMd?.escrowContract ??
                sessionMd?.escrow ??
                tip20ChannelEscrow);
            const chainId = sessionMd?.chainId ?? 0;
            const tickCost = BigInt(challengeRequest.amount);
            let cumulativeAmount = 'cumulativeAmount' in parsed.payload && parsed.payload.cumulativeAmount
                ? BigInt(parsed.payload.cumulativeAmount)
                : 0n;
            if ('descriptor' in parsed.payload)
                _session.descriptor = parsed.payload.descriptor;
            if (verbose >= 1) {
                if (parsed.payload.action === 'open') {
                    const depositRaw = challengeRequest.suggestedDeposit;
                    const depositDisplay = depositRaw
                        ? ` ${pc.dim(`(deposit ${depositRaw} ${tokenSymbol})`)}`
                        : '';
                    const prefix = confirmEnabled ? '' : '\n';
                    info(`${prefix}${pc.dim(`Channel opened ${parsed.payload.channelId}`)}${depositDisplay}\n`);
                }
                else {
                    const prefix = confirmEnabled ? '' : '\n';
                    info(`${prefix}${pc.dim(`Channel reused ${parsed.payload.channelId}`)}\n`);
                }
            }
            // Handle non-SSE session response (server returned non-streaming).
            // The open credential already paid for this unit — no follow-up
            // voucher is needed. Just record the cumulativeAmount so the
            // channel close uses the correct value.
            const credentialResponse = response;
            if (credentialResponse.ok &&
                !credentialResponse.headers.get('Content-Type')?.includes('text/event-stream')) {
                if (parsed.payload.action === 'open' && 'cumulativeAmount' in parsed.payload) {
                    cumulativeAmount = BigInt(parsed.payload.cumulativeAmount);
                }
            }
            // Print receipt from initial response headers
            const receiptHeader = credentialResponse.headers.get(Constants.Headers.paymentReceipt);
            if (receiptHeader) {
                try {
                    const receiptJson = JSON.parse(Base64.toString(receiptHeader));
                    assertReceiptWithinCliState(receiptJson, cumulativeAmount);
                    if (typeof receiptJson.acceptedCumulative === 'string' &&
                        receiptJson.acceptedCumulative) {
                        writeChannelCumulative(channelId, cumulativeAmount);
                    }
                    if (verbose >= 1)
                        printReceipt(receiptJson, {
                            info,
                            shownKeys,
                            tokenSymbol,
                            tokenDecimals,
                            explorerUrl,
                            handler: this,
                            prefix: '\n',
                        });
                }
                catch { }
            }
            const contentType = credentialResponse.headers.get('Content-Type') ?? '';
            if (contentType.includes('text/event-stream')) {
                await handleSseStream(credentialResponse, {
                    challenge,
                    channelId,
                    escrowContract,
                    chainId,
                    cumulativeAmount,
                    tickCost,
                    fetchUrl,
                    fetchInit,
                    session: _session,
                    info,
                    verbose,
                    shownKeys,
                    tokenSymbol,
                    tokenDecimals,
                    explorerUrl,
                    handler: this,
                });
            }
            else {
                // Non-SSE: print body, then close channel
                await writeResponseBody(credentialResponse);
                if (channelId && escrowContract && chainId) {
                    if (confirmEnabled)
                        info('\n');
                    if (confirmEnabled && !(await ctx.confirm('Close channel?', true))) {
                        if (verbose >= 1)
                            info(`${pc.dim('Kept channel open.')}\n`);
                    }
                    else {
                        await closeChannel({
                            channelId,
                            cumulativeAmount,
                            escrowContract,
                            chainId,
                            fetchUrl,
                            fetchInit,
                            session: _session,
                            info,
                            verbose,
                            tokenSymbol,
                            tokenDecimals,
                            explorerUrl,
                            confirmEnabled,
                        });
                    }
                }
            }
            return true;
        },
        formatReceiptField(key, value) {
            if ((key === 'reference' || key === 'txHash') &&
                typeof value === 'string' &&
                value.startsWith('0x'))
                return undefined; // let default explorer link handling apply
        },
    });
}
// --- Session helpers ---
function printReceipt(receiptJson, opts) {
    opts.info(`${opts.prefix ?? ''}${pc.bold(pc.green('Payment Receipt'))}\n`);
    const rows = [];
    const skipRef = receiptJson.channelId &&
        receiptJson.reference &&
        receiptJson.channelId === receiptJson.reference;
    const receiptBalanceKeys = new Set(['acceptedCumulative', 'spent']);
    for (const [key, value] of Object.entries(receiptJson)) {
        if (value === undefined || opts.shownKeys.has(key))
            continue;
        if (key === 'reference' && skipRef)
            continue;
        const formatted = opts.handler.formatReceiptField?.(key, value);
        if (formatted !== undefined) {
            rows.push([key, formatted]);
        }
        else if (receiptBalanceKeys.has(key) && typeof value === 'string') {
            rows.push([
                key,
                `${value} ${pc.dim(`(${fmtBalance(BigInt(value), opts.tokenSymbol, opts.tokenDecimals)})`)}`,
            ]);
        }
        else if ((key === 'reference' || key === 'txHash') &&
            typeof value === 'string' &&
            opts.explorerUrl) {
            rows.push([key, link(`${opts.explorerUrl}/tx/${value}`, value)]);
        }
        else
            rows.push([key, String(value)]);
    }
    rows.sort(([a], [b]) => a.localeCompare(b));
    const pad = Math.max(...rows.map(([k]) => k.length));
    for (const [label, value] of rows)
        opts.info(`  ${pc.dim(label.padEnd(pad))}  ${value}\n`);
    if (opts.prefix)
        opts.info('\n');
}
function assertReceiptWithinCliState(receiptJson, cumulativeAmount) {
    if (typeof receiptJson.acceptedCumulative !== 'string')
        return;
    const acceptedCumulative = BigInt(receiptJson.acceptedCumulative);
    const spent = typeof receiptJson.spent === 'string' ? BigInt(receiptJson.spent) : 0n;
    if (spent > acceptedCumulative) {
        throw new Error('receipt spent exceeds accepted cumulative voucher amount');
    }
    if (acceptedCumulative > cumulativeAmount) {
        throw new Error('receipt accepted cumulative exceeds locally signed voucher amount');
    }
    if (spent > cumulativeAmount) {
        throw new Error('receipt spent exceeds locally signed voucher amount');
    }
}
async function handleSseStream(response, opts) {
    let cumulativeAmount = opts.cumulativeAmount;
    const reader = response.body?.getReader();
    if (!reader)
        throw new Error('No response body');
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEvent = '';
    const termBg = opts.verbose ? await detectTerminalBg() : undefined;
    const chunkBgs = (() => {
        if (!termBg || !pc.isColorSupported)
            return undefined;
        const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));
        const isDark = 0.299 * termBg.r + 0.587 * termBg.g + 0.114 * termBg.b < 128;
        const offset = isDark ? 1 : -1;
        const bgRgb = (d) => (s) => {
            const r = clamp(termBg.r + d * offset);
            const g = clamp(termBg.g + d * offset);
            const b = clamp(termBg.b + d * offset);
            return `\x1b[48;2;${r};${g};${b}m${s}\x1b[49m`;
        };
        return [bgRgb(12), bgRgb(24)];
    })();
    let chunkIdx = 0;
    const writeContent = (chunk) => {
        if (chunkBgs) {
            const bgFn = chunkBgs[chunkIdx % chunkBgs.length];
            process.stdout.write(chunk.replace(/[^\n]+/g, (m) => bgFn(m)));
            chunkIdx++;
        }
        else {
            process.stdout.write(chunk);
        }
    };
    const processLines = async (lines) => {
        for (const line of lines) {
            if (line.startsWith('event: ')) {
                currentEvent = line.slice(7).trim();
                continue;
            }
            if (!line.startsWith('data: ')) {
                if (line === '')
                    currentEvent = '';
                continue;
            }
            const data = line.slice(6);
            if (data.trim() === '[DONE]')
                continue;
            if (currentEvent === 'payment-need-voucher' &&
                opts.channelId &&
                opts.escrowContract &&
                opts.chainId) {
                try {
                    const event = JSON.parse(data);
                    if (event.channelId !== opts.channelId) {
                        throw new Error('payment-need-voucher channelId does not match current session');
                    }
                    const required = BigInt(event.requiredCumulative);
                    if (required > cumulativeAmount + opts.tickCost) {
                        throw new Error('payment-need-voucher exceeds next locally billable amount');
                    }
                    cumulativeAmount = cumulativeAmount > required ? cumulativeAmount : required;
                    const voucherCred = await opts.session.signVoucher({
                        channelId: opts.channelId,
                        cumulativeAmount,
                        escrowContract: opts.escrowContract,
                        chainId: opts.chainId,
                    });
                    await globalThis.fetch(opts.fetchUrl, {
                        method: 'POST',
                        headers: { [Constants.Headers.authorization]: voucherCred },
                    });
                }
                catch (e) {
                    opts.info(pc.dim(pc.yellow(` [voucher failed: ${e instanceof Error ? e.message : e}]`)));
                }
                currentEvent = '';
                continue;
            }
            if (currentEvent === 'payment-receipt') {
                if (opts.verbose >= 1) {
                    try {
                        const receipt = JSON.parse(data);
                        printReceipt(receipt, {
                            info: opts.info,
                            shownKeys: opts.shownKeys,
                            tokenSymbol: opts.tokenSymbol,
                            tokenDecimals: opts.tokenDecimals,
                            explorerUrl: opts.explorerUrl,
                            handler: opts.handler,
                            prefix: '\n\n',
                        });
                    }
                    catch { }
                }
                currentEvent = '';
                continue;
            }
            if (data.length === 0) {
                writeContent('\n');
            }
            else {
                try {
                    const parsed = JSON.parse(data);
                    writeContent(parsed.token ?? parsed.choices?.[0]?.delta?.content ?? data);
                }
                catch {
                    writeContent(data);
                }
            }
            currentEvent = '';
        }
    };
    while (true) {
        const { done, value } = await reader.read();
        if (done)
            break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        await processLines(lines);
    }
    if (buffer.trim())
        await processLines([buffer]);
    // Close channel after SSE stream ends
    if (opts.channelId && opts.escrowContract && opts.chainId) {
        await closeChannel({
            channelId: opts.channelId,
            cumulativeAmount,
            escrowContract: opts.escrowContract,
            chainId: opts.chainId,
            fetchUrl: opts.fetchUrl,
            fetchInit: opts.fetchInit,
            session: opts.session,
            info: opts.info,
            verbose: opts.verbose,
            tokenSymbol: opts.tokenSymbol,
            tokenDecimals: opts.tokenDecimals,
            explorerUrl: opts.explorerUrl,
            confirmEnabled: false,
        });
    }
}
async function closeChannel(opts) {
    const closeCred = await opts.session.signVoucher({
        channelId: opts.channelId,
        cumulativeAmount: opts.cumulativeAmount,
        escrowContract: opts.escrowContract,
        chainId: opts.chainId,
        action: 'close',
    });
    const closeRes = await globalThis.fetch(opts.fetchUrl, {
        ...opts.fetchInit,
        headers: {
            ...normalizeHeaders(opts.fetchInit.headers),
            Authorization: closeCred,
        },
    });
    if (closeRes.ok) {
        deleteChannelState(opts.channelId);
        if (opts.verbose >= 1) {
            const closeReceiptHeader = closeRes.headers.get(Constants.Headers.paymentReceipt);
            let closeTxHash;
            if (closeReceiptHeader) {
                try {
                    const r = JSON.parse(Base64.toString(closeReceiptHeader));
                    if (typeof r.txHash === 'string')
                        closeTxHash = r.txHash;
                }
                catch { }
            }
            const txInfo = closeTxHash && opts.explorerUrl
                ? ` ${pc.dim(link(`${opts.explorerUrl}/tx/${closeTxHash}`, closeTxHash))}`
                : '';
            opts.info(`${pc.dim('Channel closed.')} ${pc.dim(`Spent ${fmtBalance(opts.cumulativeAmount, opts.tokenSymbol, opts.tokenDecimals)}.`)}${txInfo}\n`);
        }
    }
    else {
        const closeBody = await closeRes.text().catch(() => '');
        opts.info(`\n${pc.dim(pc.yellow('Channel close failed'))} ${pc.dim(`(${closeRes.status})`)}\n`);
        opts.info(`${pc.dim(`  channelId:          ${opts.channelId}`)}\n` +
            `${pc.dim(`  cumulativeAmount:   ${opts.cumulativeAmount}`)}\n` +
            `${pc.dim(`  escrowContract:     ${opts.escrowContract}`)}\n` +
            `${pc.dim(`  chainId:            ${opts.chainId}`)}\n` +
            `${pc.dim(`  response:           ${closeBody || '(empty)'}`)}\n`);
    }
}
function detectTerminalBg(timeoutMs = 100) {
    if (!process.stdin.isTTY || !process.stdout.isTTY)
        return Promise.resolve(undefined);
    return new Promise((resolve) => {
        const wasRaw = process.stdin.isRaw;
        let buf = '';
        const cleanup = () => {
            clearTimeout(timer);
            process.stdin.removeListener('data', onData);
            if (process.stdin.isTTY)
                process.stdin.setRawMode(wasRaw ?? false);
            process.stdin.pause();
        };
        const timer = setTimeout(() => {
            cleanup();
            resolve(undefined);
        }, timeoutMs);
        const onData = (data) => {
            buf += data.toString();
            // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequence for terminal background detection
            const match = buf.match(/\x1b\]11;rgb:([0-9a-f]+)\/([0-9a-f]+)\/([0-9a-f]+)/i);
            if (!match)
                return;
            cleanup();
            const parse = (hex) => Number.parseInt(hex.slice(0, 2), 16);
            resolve({ r: parse(match[1]), g: parse(match[2]), b: parse(match[3]) });
        };
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.on('data', onData);
        process.stdout.write('\x1b]11;?\x07');
    });
}
function parseTempoOptions(rawOptions) {
    return parseOptions(tempoOptionSchema, rawOptions, tempoOptionKeys);
}
function isTempoChargeChallenge(challenge) {
    return challenge.method === 'tempo' && challenge.intent === 'charge';
}
async function resolveBalanceProbe(ctx) {
    const accountName = resolveAccountName(ctx.options.account);
    const privateKey = process.env.MPPX_PRIVATE_KEY?.trim() ||
        (isTempoAccount(accountName) ? undefined : await createKeychain(accountName).get());
    let account;
    if (privateKey) {
        account = privateKeyToAccount(privateKey).address;
    }
    else if (isTempoAccount(accountName) && hasTempoCliSync()) {
        account = resolveTempoAccount(accountName)?.wallet_address;
    }
    else {
        const fallback = fallbackFromTempo();
        if (fallback) {
            const fallbackKey = await createKeychain(fallback).get();
            if (fallbackKey)
                account = privateKeyToAccount(fallbackKey).address;
        }
    }
    if (!account)
        return undefined;
    const rpcUrl = resolveRpcUrl(ctx.options.rpcUrl, { network: ctx.options.network });
    const client = createClient({
        chain: await resolveChain({ network: ctx.options.network, rpcUrl }),
        transport: http(rpcUrl),
    });
    return {
        account,
        client,
    };
}
async function scoreTempoChargeChallenge(challenge, probe) {
    const request = challenge.request;
    const currency = request.currency;
    const amount = request.amount;
    if (typeof currency !== 'string' || typeof amount !== 'string')
        return 'unsupported';
    const requiredChainId = request.methodDetails?.chainId;
    if (requiredChainId && probe.client.chain?.id && requiredChainId !== probe.client.chain.id) {
        return 'unsupported';
    }
    const amountRaw = BigInt(amount);
    if (amountRaw === 0n)
        return 'payable';
    const balance = await Actions.token
        .getBalance(probe.client, {
        account: probe.account,
        token: currency,
    })
        .then((value) => value.amount)
        .catch(() => undefined);
    if (balance === undefined)
        return 'unknownBalance';
    if (balance >= amountRaw)
        return 'payable';
    return 'insufficientBalance';
}
function parseOptions(schema, rawOptions, allowedKeys) {
    if (rawOptions && typeof rawOptions === 'object' && !Array.isArray(rawOptions)) {
        const unknownKeys = Object.keys(rawOptions).filter((key) => !allowedKeys.includes(key));
        if (unknownKeys.length)
            throw new Error(`Unsupported CLI method option(s): ${unknownKeys.join(', ')}`);
    }
    const result = schema.safeParse(rawOptions ?? {});
    if (result.success)
        return result.data;
    const summary = result.error.issues
        .map((issue) => {
        const path = issue.path.length ? issue.path.join('.') : 'options';
        return `${path}: ${issue.message}`;
    })
        .join(', ');
    throw new Error(`Invalid CLI options (${summary})`);
}
function assertChallengeChain(opts) {
    const methodDetails = opts.challenge.request.methodDetails;
    const requiredChainId = methodDetails?.chainId;
    if (!requiredChainId || !opts.clientChainId || requiredChainId === opts.clientChainId)
        return;
    const hint = requiredChainId === 4217
        ? ' Use --network mainnet or --rpc-url https://rpc.tempo.xyz.'
        : requiredChainId === 42431
            ? ' Use --network testnet or --rpc-url https://rpc.moderato.tempo.xyz.'
            : '';
    throw new Errors.IncurError({
        code: 'CHAIN_MISMATCH',
        message: `Challenge requires chainId ${requiredChainId}, but RPC is chainId ${opts.clientChainId}.${hint}`,
        exitCode: 2,
    });
}
function parseTokenList(value) {
    if (!value)
        return undefined;
    return value
        .split(',')
        .map((token) => token.trim())
        .filter(Boolean);
}
function resolveAutoSwap(opts) {
    const tokenIn = parseTokenList(opts.tokenIn) ?? parseTokenList(opts.payWith);
    if (!opts.autoSwap && !tokenIn && opts.slippage === undefined)
        return undefined;
    if (opts.autoSwap === false && !tokenIn && opts.slippage === undefined)
        return false;
    if (opts.slippage !== undefined && (!Number.isFinite(opts.slippage) || opts.slippage < 0))
        throw new Error('Invalid CLI options (slippage: expected a non-negative number)');
    return {
        ...(tokenIn ? { tokenIn } : {}),
        ...(opts.slippage !== undefined ? { slippage: opts.slippage } : {}),
    };
}
function channelStateDir() {
    return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'mppx', 'channels');
}
function readChannelCumulative(channelId) {
    try {
        const raw = fs.readFileSync(path.join(channelStateDir(), channelId), 'utf-8').trim();
        return raw ? BigInt(raw) : undefined;
    }
    catch {
        return undefined;
    }
}
function writeChannelCumulative(channelId, cumulative) {
    const dir = channelStateDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, channelId), cumulative.toString(), 'utf-8');
}
function deleteChannelState(channelId) {
    try {
        fs.unlinkSync(path.join(channelStateDir(), channelId));
    }
    catch { }
}
function tempoKeystorePath() {
    const platform = os.platform();
    if (platform === 'darwin')
        return path.join(os.homedir(), 'Library', 'Application Support', 'tempo', 'wallet', 'keys.toml');
    return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'tempo', 'wallet', 'keys.toml');
}
export function readTempoKeystore() {
    try {
        const raw = fs.readFileSync(tempoKeystorePath(), 'utf-8');
        const entries = [];
        let current;
        for (const line of raw.split('\n')) {
            const trimmed = line.trim();
            if (trimmed === '[[keys]]') {
                if (current?.wallet_address)
                    entries.push(current);
                current = { wallet_type: 'local', wallet_address: '', chain_id: 0 };
                continue;
            }
            if (!current)
                continue;
            const m = trimmed.match(/^(\w+)\s*=\s*"?([^"]*)"?$/);
            if (!m)
                continue;
            const [, key, value] = m;
            if (key === 'wallet_type')
                current.wallet_type = value;
            else if (key === 'wallet_address')
                current.wallet_address = value;
            else if (key === 'chain_id')
                current.chain_id = Number.parseInt(value, 10);
        }
        if (current?.wallet_address)
            entries.push(current);
        return entries;
    }
    catch {
        return [];
    }
}
export function resolveTempoAccount(accountName) {
    const entries = readTempoKeystore();
    if (entries.length === 0)
        return undefined;
    const suffix = accountName.slice('tempo:'.length);
    if (suffix === 'default' || suffix === '')
        return entries[0];
    const idx = Number.parseInt(suffix, 10);
    if (!Number.isNaN(idx) && idx >= 0 && idx < entries.length)
        return entries[idx];
    return undefined;
}
let _tempoCliAvailable;
function hasTempoCliSync() {
    if (_tempoCliAvailable !== undefined)
        return _tempoCliAvailable;
    try {
        child.execFileSync('which', ['tempo'], { stdio: 'ignore' });
        _tempoCliAvailable = true;
    }
    catch {
        _tempoCliAvailable = false;
    }
    return _tempoCliAvailable;
}
async function tempoCliSign(wwwAuth) {
    return new Promise((resolve, reject) => {
        child.execFile('tempo', ['mpp', 'sign', '--challenge', wwwAuth], (error, stdout, stderr) => {
            if (error) {
                const msg = stderr?.trim() || error.message;
                reject(new Error(`tempo mpp sign failed: ${msg}`));
                return;
            }
            const trimmed = stdout.trim();
            if (!trimmed) {
                reject(new Error('tempo mpp sign returned empty output'));
                return;
            }
            resolve(trimmed);
        });
    });
}
function fallbackFromTempo() {
    const store = createDefaultStore();
    const currentDefault = store.get();
    if (!isTempoAccount(currentDefault))
        return undefined;
    if (hasTempoCliSync())
        return undefined;
    const platform = os.platform();
    if (platform === 'darwin') {
        try {
            const stdout = child.execFileSync('security', ['dump-keychain'], { encoding: 'utf-8' });
            const mppxAccounts = [];
            for (const block of stdout.split('keychain:')) {
                const serviceMatch = block.match(/"svce"<blob>="([^"]*)"/);
                const accountMatch = block.match(/"acct"<blob>="([^"]*)"/);
                if (serviceMatch?.[1] === packageName && accountMatch?.[1])
                    mppxAccounts.push(accountMatch[1]);
            }
            if (mppxAccounts.length > 0) {
                store.set(mppxAccounts[0]);
                return mppxAccounts[0];
            }
        }
        catch { }
    }
    return undefined;
}
//# sourceMappingURL=tempo.js.map