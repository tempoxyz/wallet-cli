export declare function execCommand(command: string, args: string[]): Promise<{
    stdout: string;
    stderr: string;
    error: Error | null;
}>;
export declare function createDefaultStore(): {
    get(): string;
    set(value: string): void;
    clear(): void;
};
export declare function resolveAccountName(explicit?: string): string;
export declare function createKeychain(account?: string): {
    list(): Promise<string[]>;
    get(): Promise<string | undefined>;
    set(value: string): Promise<void>;
    delete(): Promise<void>;
};
/** Resolves a local CLI signer together with its durable account reference. */
export declare function resolveLocalAccount(name?: string): Promise<{
    account: {
        address: import("viem/accounts").Address;
        nonceManager?: import("viem/accounts").NonceManager | undefined;
        sign: (parameters: {
            hash: import("viem").Hash;
        }) => Promise<import("viem").Hex>;
        signAuthorization: (parameters: import("viem").AuthorizationRequest) => Promise<import("viem/accounts").SignAuthorizationReturnType>;
        signMessage: ({ message }: {
            message: import("viem").SignableMessage;
        }) => Promise<import("viem").Hex>;
        signTransaction: <serializer extends import("viem").SerializeTransactionFn<import("viem").TransactionSerializable> = import("viem").SerializeTransactionFn<import("viem").TransactionSerializable>, transaction extends Parameters<serializer>[0] = Parameters<serializer>[0]>(transaction: transaction, options?: {
            serializer?: serializer | undefined;
        } | undefined) => Promise<import("viem").Hex>;
        signTypedData: <const typedData extends import("viem").TypedData | Record<string, unknown>, primaryType extends keyof typedData | 'EIP712Domain' = keyof typedData>(parameters: import("viem").TypedDataDefinition<typedData, primaryType>) => Promise<import("viem").Hex>;
        publicKey: import("viem").Hex;
        source: "privateKey";
        type: 'local';
    };
    source: 'environment';
    accountName?: undefined;
} | {
    account: {
        address: import("viem/accounts").Address;
        nonceManager?: import("viem/accounts").NonceManager | undefined;
        sign: (parameters: {
            hash: import("viem").Hash;
        }) => Promise<import("viem").Hex>;
        signAuthorization: (parameters: import("viem").AuthorizationRequest) => Promise<import("viem/accounts").SignAuthorizationReturnType>;
        signMessage: ({ message }: {
            message: import("viem").SignableMessage;
        }) => Promise<import("viem").Hex>;
        signTransaction: <serializer extends import("viem").SerializeTransactionFn<import("viem").TransactionSerializable> = import("viem").SerializeTransactionFn<import("viem").TransactionSerializable>, transaction extends Parameters<serializer>[0] = Parameters<serializer>[0]>(transaction: transaction, options?: {
            serializer?: serializer | undefined;
        } | undefined) => Promise<import("viem").Hex>;
        signTypedData: <const typedData extends import("viem").TypedData | Record<string, unknown>, primaryType extends keyof typedData | 'EIP712Domain' = keyof typedData>(parameters: import("viem").TypedDataDefinition<typedData, primaryType>) => Promise<import("viem").Hex>;
        publicKey: import("viem").Hex;
        source: "privateKey";
        type: 'local';
    };
    accountName: string;
    source: 'keychain';
}>;
/** Resolves an account supported by persistent CLI sessions. */
export declare function resolvePersistentAccount(name?: string): Promise<{
    account: {
        address: import("viem/accounts").Address;
        nonceManager?: import("viem/accounts").NonceManager | undefined;
        sign: (parameters: {
            hash: import("viem").Hash;
        }) => Promise<import("viem").Hex>;
        signAuthorization: (parameters: import("viem").AuthorizationRequest) => Promise<import("viem/accounts").SignAuthorizationReturnType>;
        signMessage: ({ message }: {
            message: import("viem").SignableMessage;
        }) => Promise<import("viem").Hex>;
        signTransaction: <serializer extends import("viem").SerializeTransactionFn<import("viem").TransactionSerializable> = import("viem").SerializeTransactionFn<import("viem").TransactionSerializable>, transaction extends Parameters<serializer>[0] = Parameters<serializer>[0]>(transaction: transaction, options?: {
            serializer?: serializer | undefined;
        } | undefined) => Promise<import("viem").Hex>;
        signTypedData: <const typedData extends import("viem").TypedData | Record<string, unknown>, primaryType extends keyof typedData | 'EIP712Domain' = keyof typedData>(parameters: import("viem").TypedDataDefinition<typedData, primaryType>) => Promise<import("viem").Hex>;
        publicKey: import("viem").Hex;
        source: "privateKey";
        type: 'local';
    };
    source: 'environment';
    accountName?: undefined;
} | {
    account: {
        address: import("viem/accounts").Address;
        nonceManager?: import("viem/accounts").NonceManager | undefined;
        sign: (parameters: {
            hash: import("viem").Hash;
        }) => Promise<import("viem").Hex>;
        signAuthorization: (parameters: import("viem").AuthorizationRequest) => Promise<import("viem/accounts").SignAuthorizationReturnType>;
        signMessage: ({ message }: {
            message: import("viem").SignableMessage;
        }) => Promise<import("viem").Hex>;
        signTransaction: <serializer extends import("viem").SerializeTransactionFn<import("viem").TransactionSerializable> = import("viem").SerializeTransactionFn<import("viem").TransactionSerializable>, transaction extends Parameters<serializer>[0] = Parameters<serializer>[0]>(transaction: transaction, options?: {
            serializer?: serializer | undefined;
        } | undefined) => Promise<import("viem").Hex>;
        signTypedData: <const typedData extends import("viem").TypedData | Record<string, unknown>, primaryType extends keyof typedData | 'EIP712Domain' = keyof typedData>(parameters: import("viem").TypedDataDefinition<typedData, primaryType>) => Promise<import("viem").Hex>;
        publicKey: import("viem").Hex;
        source: "privateKey";
        type: 'local';
    };
    accountName: string;
    source: 'keychain';
}>;
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
export declare function resolveAccount(name?: string): Promise<{
    address: import("viem/accounts").Address;
    nonceManager?: import("viem/accounts").NonceManager | undefined;
    sign: (parameters: {
        hash: import("viem").Hash;
    }) => Promise<import("viem").Hex>;
    signAuthorization: (parameters: import("viem").AuthorizationRequest) => Promise<import("viem/accounts").SignAuthorizationReturnType>;
    signMessage: ({ message }: {
        message: import("viem").SignableMessage;
    }) => Promise<import("viem").Hex>;
    signTransaction: <serializer extends import("viem").SerializeTransactionFn<import("viem").TransactionSerializable> = import("viem").SerializeTransactionFn<import("viem").TransactionSerializable>, transaction extends Parameters<serializer>[0] = Parameters<serializer>[0]>(transaction: transaction, options?: {
        serializer?: serializer | undefined;
    } | undefined) => Promise<import("viem").Hex>;
    signTypedData: <const typedData extends import("viem").TypedData | Record<string, unknown>, primaryType extends keyof typedData | 'EIP712Domain' = keyof typedData>(parameters: import("viem").TypedDataDefinition<typedData, primaryType>) => Promise<import("viem").Hex>;
    publicKey: import("viem").Hex;
    source: "privateKey";
    type: 'local';
}>;
//# sourceMappingURL=account.d.ts.map