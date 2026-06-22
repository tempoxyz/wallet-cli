export const version = process.env.TEMPO_WALLET_VERSION ?? "0.6.1";
export const usdcToken = "0x20c000000000000000000000b9537d11c60e8b50" as const;
export const mainnetEscrow = "0x33b901018174ddabe4841042ab76ba85d4e24f25" as const;
export const moderatoEscrow = "0xe1c4d3dce17bc111181ddf716f75bae49e61a336" as const;
export const defaultGracePeriodSeconds = 900;
export const logQueryBlockRange = 50_000n;
export const logScanDepth = 100_000n;
export const logHeadMargin = 10n;

export const escrowAbi = [
  {
    type: "function",
    name: "getChannel",
    stateMutability: "view",
    inputs: [{ name: "channelId", type: "bytes32" }],
    outputs: [
      { name: "finalized", type: "bool" },
      { name: "closeRequestedAt", type: "uint64" },
      { name: "payer", type: "address" },
      { name: "payee", type: "address" },
      { name: "token", type: "address" },
      { name: "authorizedSigner", type: "address" },
      { name: "deposit", type: "uint128" },
      { name: "settled", type: "uint128" },
    ],
  },
  {
    type: "function",
    name: "CLOSE_GRACE_PERIOD",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "period", type: "uint64" }],
  },
  {
    type: "function",
    name: "topUp",
    stateMutability: "nonpayable",
    inputs: [
      { name: "channelId", type: "bytes32" },
      { name: "additionalDeposit", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "requestClose",
    stateMutability: "nonpayable",
    inputs: [{ name: "channelId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [{ name: "channelId", type: "bytes32" }],
    outputs: [],
  },
] as const;
