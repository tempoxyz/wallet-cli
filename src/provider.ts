import type { Provider as CoreProvider } from 'accounts'
import { Provider } from 'accounts'
import { Storage } from 'accounts/cli'
import { tempoWallet } from 'accounts/deviceCode'

import { openExternal } from './shared/process.js'

export function createProvider(
  options: { network?: string | undefined; noBrowser?: boolean | undefined } = {},
): CoreProvider.Provider {
  return Provider.create({
    adapter: tempoWallet({
      onPrompt(prompt) {
        const url = prompt.verificationUriFull ?? prompt.verificationUri
        console.error(`Confirm code ${prompt.userCode} at: ${url}`)
        if (!options.noBrowser) openExternal(url)
      },
    }),
    // The CLI-friendly pull mode, matching the legacy `accounts/cli` provider.
    mpp: { mode: 'pull' },
    storage: Storage.filesystem(),
    testnet: options.network === 'testnet' || process.env.TEMPO_WALLET_NETWORK === 'testnet',
  }) as CoreProvider.Provider
}

export async function connect(provider: CoreProvider.Provider) {
  return provider.request({
    method: 'wallet_connect',
    params: [
      {
        capabilities: {
          authorizeAccessKey: {
            expiry: Math.floor(Date.now() / 1000) + 86_400,
          },
        },
      },
    ],
  })
}
