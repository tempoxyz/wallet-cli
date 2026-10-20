import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";

import {
  type Abi,
  type Account,
  type Address,
  createClient,
  defineChain,
  erc20Abi,
  type Hex,
  http,
  parseAbi,
  publicActions,
  walletActions,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { Actions, Addresses, Chain } from "viem/tempo";

const exec = promisify(execFile);
const compose = new URL("./compose.yaml", import.meta.url).pathname;
const localToken = JSON.parse(
  readFileSync(new URL("./contracts/LocalToken.json", import.meta.url), "utf8"),
) as { abi: Abi; bytecode: Hex };
const mintAbi = parseAbi(["function mint(address to,uint256 value)"]);
const localBridges = JSON.parse(
  readFileSync(new URL("./contracts/LocalBridges.json", import.meta.url), "utf8"),
) as {
  contracts: Record<
    "LocalDepository" | "LocalFeeWrapper" | "LocalStargate",
    { abi: Abi; bytecode: Hex }
  >;
};

/** The local Stargate's fee: 1 basis point of the amount, plus 0.001 of LayerZero messaging fee. */
export const localStargateFee = { bps: 1n, native: 1_000n };
/** The LayerZero endpoint ID the local Stargate uses for the EVM chain. */
export const localEndpointId = 40_338;

/** Anvil's first dev account: it issues every local token and holds the relay's inventory. */
export const maker = mnemonicToAccount(
  "test test test test test test test test test test test junk",
);

/** Where the local chains run and which tokens they hold; plain data, shared with test workers. */
export type Localnet = {
  tempoUrl: string;
  evmUrl: string;
  tempoChainId: number;
  evmChainId: number;
  /** Local stand-in for OUSD: a USD TIP-20 the wallet funds payments from. */
  ousd: Address;
  /** A USD TIP-20 the local MPP server charges in, bought from OUSD on the DEX. */
  usdc: Address;
  /** EIP-3009 USDC on the stand-in for Base. */
  evmUsdc: Address;
  /** Stand-in for Relay's v2 depository on the Tempo chain. */
  depository: Address;
  /** Stand-in for Stargate's OFT for `usdc` on the Tempo chain, and its LZD fee wrapper. */
  stargate: Address;
  feeWrapper: Address;
};

/** Starts fresh containers with random loopback ports; `close` removes them. */
export async function startNodes(project: string) {
  const run = (...args: string[]) =>
    exec("docker", ["compose", "-f", compose, "-p", project, ...args]);
  const close = async () => {
    await run("down", "--volumes", "--timeout", "1");
  };
  const url = async (service: string) =>
    `http://${(await run("port", service, "8545")).stdout.trim()}`;
  try {
    await run("up", "-d", "--wait", "--wait-timeout", "90");
    return { tempoUrl: await url("tempo"), evmUrl: await url("evm"), close };
  } catch (error) {
    await close().catch(() => undefined);
    throw new Error(
      `Unable to start local chains with Docker Compose: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function tempoChain(net: Pick<Localnet, "tempoUrl">) {
  return defineChain({ ...Chain.tempoModerato, rpcUrls: { default: { http: [net.tempoUrl] } } });
}

export function evmChain(net: Pick<Localnet, "evmUrl" | "evmChainId">) {
  return defineChain({
    ...foundry,
    id: net.evmChainId,
    name: "Local EVM",
    rpcUrls: { default: { http: [net.evmUrl] } },
  });
}

export function tempoClient(net: Pick<Localnet, "tempoUrl">, account: Account = maker) {
  return createClient({
    account,
    chain: tempoChain(net),
    pollingInterval: 50,
    transport: http(net.tempoUrl),
  })
    .extend(publicActions)
    .extend(walletActions);
}

export function evmClient(net: Pick<Localnet, "evmUrl" | "evmChainId">, account: Account = maker) {
  return createClient({
    account,
    chain: evmChain(net),
    pollingInterval: 50,
    transport: http(net.evmUrl),
  })
    .extend(publicActions)
    .extend(walletActions);
}

/**
 * Deploys the local tokens and liquidity: OUSD and USDC TIP-20s with DEX books through pathUSD (so
 * OUSD buys USDC in one multi-hop swap), fee AMM pools so accounts can pay fees in either, and
 * EIP-3009 USDC on the EVM chain with relay inventory held by `maker`.
 */
export async function provision(nodes: { tempoUrl: string; evmUrl: string }): Promise<Localnet> {
  const base = {
    tempoUrl: nodes.tempoUrl,
    evmUrl: nodes.evmUrl,
    tempoChainId: Chain.tempoModerato.id,
    evmChainId: 31338,
  };
  const tempo = tempoClient(base);
  const created: Address[] = [];
  for (const symbol of ["OUSD", "USDC"]) {
    const { token } = await Actions.token.createSync(tempo, {
      name: symbol,
      symbol,
      currency: "USD",
      quoteToken: Addresses.pathUsd,
      feeToken: Addresses.pathUsd,
    });
    await Actions.token.grantRolesSync(tempo, {
      token,
      to: maker.address,
      roles: ["issuer"],
      feeToken: Addresses.pathUsd,
    });
    await Actions.token.mintSync(tempo, {
      token,
      to: maker.address,
      amount: 1_000_000_000_000n,
      feeToken: Addresses.pathUsd,
    });
    await Actions.token.approveSync(tempo, {
      token,
      spender: Addresses.stablecoinDex,
      amount: 1_000_000_000_000n,
      feeToken: Addresses.pathUsd,
    });
    await Actions.dex.createPairSync(tempo, { base: token, feeToken: Addresses.pathUsd });
    created.push(token);
  }
  const [ousd, usdc] = created as [Address, Address];
  await Actions.token.approveSync(tempo, {
    token: Addresses.pathUsd,
    spender: Addresses.stablecoinDex,
    amount: 1_000_000_000_000n,
    feeToken: Addresses.pathUsd,
  });
  // The maker sells USDC for pathUSD and buys OUSD with pathUSD, both at parity.
  await Actions.dex.placeSync(tempo, {
    token: usdc,
    amount: 100_000_000_000n,
    type: "sell",
    tick: 0,
    feeToken: Addresses.pathUsd,
  });
  await Actions.dex.placeSync(tempo, {
    token: ousd,
    amount: 100_000_000_000n,
    type: "buy",
    tick: 0,
    feeToken: Addresses.pathUsd,
  });
  // A transaction may pay its fee in any token it touches, so each can be swapped for pathUSD.
  for (const token of created)
    await Actions.amm.mintSync(tempo, {
      userTokenAddress: token,
      validatorTokenAddress: Addresses.pathUsd,
      validatorTokenAmount: 100_000_000_000n,
      to: maker.address,
      feeToken: Addresses.pathUsd,
    });

  const evm = evmClient(base);
  const hash = await evm.deployContract({
    abi: localToken.abi,
    bytecode: localToken.bytecode,
    args: ["USDC", "USDC"],
  });
  const receipt = await evm.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress)
    throw new Error("Local USDC deployment failed");
  const evmUsdc = receipt.contractAddress;
  await confirmed(
    evm,
    await evm.writeContract({
      address: evmUsdc,
      abi: mintAbi,
      functionName: "mint",
      args: [maker.address, 1_000_000_000_000n],
    }),
  );
  const deploy = async (name: keyof typeof localBridges.contracts, args: unknown[] = []) => {
    const { abi, bytecode } = localBridges.contracts[name];
    const hash = await tempo.deployContract({
      abi,
      bytecode,
      args,
      feeToken: Addresses.pathUsd,
    } as never);
    const receipt = await tempo.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success" || !receipt.contractAddress)
      throw new Error(`Local ${name} deployment failed`);
    return receipt.contractAddress;
  };
  const depository = await deploy("LocalDepository");
  const feeWrapper = await deploy("LocalFeeWrapper");
  const stargate = await deploy("LocalStargate", [
    usdc,
    feeWrapper,
    localStargateFee.bps,
    localStargateFee.native,
  ]);
  return { ...base, ousd, usdc, evmUsdc, depository, stargate, feeWrapper };
}

async function confirmed(client: ReturnType<typeof evmClient>, hash: Hex) {
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("Local setup transaction reverted");
  return receipt;
}

/** A TIP-20 balance on the local Tempo chain, in atomic units. */
export async function tempoBalance(net: Localnet, token: Address, account: Address) {
  return (await Actions.token.getBalance(tempoClient(net), { token, account })).amount;
}

/** An ERC-20 balance on the local EVM chain, in atomic units. */
export function evmBalance(net: Localnet, token: Address, account: Address) {
  return evmClient(net).readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account],
  });
}
