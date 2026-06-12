import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, expect, vi } from 'vitest'

import type { WalletState } from '../src/wallet/store.js'

const originalHome = process.env.HOME

const homes = new Set<string>()

afterEach(async () => {
  vi.restoreAllMocks()
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome

  await Promise.all([...homes].map((home) => rm(home, { force: true, recursive: true })))
  homes.clear()
})

export async function useTempHome() {
  const home = await mkdtemp(join(tmpdir(), 'wallet-cli-test-'))
  homes.add(home)
  process.env.HOME = home
  await mkdir(join(home, '.tempo', 'wallet'), { recursive: true })
  return home
}

export async function writeWalletState(state: WalletState) {
  const home = process.env.HOME
  if (!home) throw new Error('HOME must be set before writing wallet state')

  await mkdir(join(home, '.tempo', 'wallet'), { recursive: true })
  await writeFile(
    join(home, '.tempo', 'wallet', 'store.json'),
    `${JSON.stringify(
      {
        'tempo-cli.store': {
          state: {
            accounts: state.accounts,
            accessKeys: state.accessKeys,
            activeAccount: state.activeAccount ?? 0,
            chainId: state.chainId ?? 4217,
          },
          version: 0,
        },
      },
      null,
      2,
    )}\n`,
  )
}

export async function readWalletStoreJson() {
  const home = process.env.HOME
  if (!home) throw new Error('HOME must be set before reading wallet state')
  return JSON.parse(await readFile(join(home, '.tempo', 'wallet', 'store.json'), 'utf8')) as unknown
}

export const testWallet = '0xABFB663C1F9cd7438f54846D6B827E315719eC0f'
export const testAccessKey = '0x4cdadb819a7fc083b72ada08288a96424f34c8a0'
export const testPrivateKey = '0x2c04876ec5dd00c9bd039e389e809027140b1c149658b5c1a293fa4feced2e93'
export const usdc = '0x20C000000000000000000000b9537d11c60E8b50'

export function walletState(overrides: Partial<WalletState> = {}): WalletState {
  return {
    accounts: [{ address: testWallet }],
    accessKeys: [
      {
        address: testAccessKey,
        access: testWallet,
        chainId: 4217,
        expiry: 1783809942,
        keyType: 'secp256k1',
        privateKey: testPrivateKey,
        limits: [{ token: usdc, limit: '100000000#__bigint' }],
      },
    ],
    activeAccount: 0,
    chainId: 4217,
    ...overrides,
  }
}

export function expectUsageError(error: unknown, message: string) {
  expect(error).toMatchObject({ code: 'E_USAGE', exitCode: 2, message })
}
