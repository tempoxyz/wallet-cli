import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fundAction, runFundingFlow } from '../src/commands/fund.js'
import { fetchServices, fetchServiceList } from '../src/commands/services.js'
import { expectUsageError, useTempHome } from './helpers.js'

type ServiceSummary = Awaited<ReturnType<typeof fetchServiceList>>[number]

describe('fundAction', () => {
  it('returns "fund" by default', () => {
    expect(fundAction({})).toBe('fund')
  })

  it('returns "credits" when credits is set', () => {
    expect(fundAction({ credits: true })).toBe('credits')
  })

  it('returns "crypto" when crypto is set', () => {
    expect(fundAction({ crypto: true })).toBe('crypto')
  })

  it('returns "claim" when a referral code is provided', () => {
    expect(fundAction({ referralCode: 'ABC' })).toBe('claim')
  })

  it('prioritizes credits over crypto and referral code', () => {
    expect(fundAction({ credits: true, crypto: true, referralCode: 'ABC' })).toBe('credits')
  })

  it('prioritizes crypto over referral code', () => {
    expect(fundAction({ crypto: true, referralCode: 'ABC' })).toBe('crypto')
  })
})

describe('runFundingFlow', () => {
  let consoleError: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    delete process.env.TEMPO_WALLET_FUND_POLL_MS
    delete process.env.TEMPO_WALLET_FUND_TIMEOUT_MS
  })

  it('throws E_USAGE for crypto funding when no wallet is configured', async () => {
    await useTempHome()

    const error = await runFundingFlow({ action: 'crypto', noBrowser: true }).catch((e) => e)
    expectUsageError(error, "Configuration missing: No wallet configured. Run 'tempo wallet login'.")
  })

  it('throws E_USAGE for default funding when no wallet is configured', async () => {
    await useTempHome()

    const error = await runFundingFlow({ action: 'fund', noBrowser: true }).catch((e) => e)
    expectUsageError(error, "Configuration missing: No wallet configured. Run 'tempo wallet login'.")
  })

  it('prints the claim URL without a wallet before timing out (no network wait)', async () => {
    await useTempHome()
    // Fail fast: tiny poll interval and zero timeout so we never wait on the network.
    process.env.TEMPO_WALLET_FUND_POLL_MS = '1'
    process.env.TEMPO_WALLET_FUND_TIMEOUT_MS = '0'

    const error = await runFundingFlow({
      action: 'claim',
      code: 'REF123',
      noBrowser: true,
    }).catch((e) => e)

    // The claim URL is printed before the (timing-out) wait loop.
    const printed = consoleError.mock.calls.map((call: unknown[]) => String(call[0])).join('\n')
    expect(printed).toContain('https://wallet.tempo.xyz/?claim=REF123')

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('Timed out waiting for funding')
  })
})

describe('fetchServices', () => {
  const serviceDirectory = {
    services: [
      {
        id: 'weather',
        name: 'Weather API',
        url: 'https://weather.example.com',
        serviceUrl: 'https://weather.mpp.tempo.xyz',
        description: 'Forecasts and current conditions',
        categories: ['data', 'climate'],
        tags: ['forecast', 'meteorology'],
        endpoints: [
          {
            method: 'GET',
            path: '/now',
            description: 'Current weather',
            payment: { intent: 'pay', amount: '100', decimals: 6, unitType: 'usdc' },
            docs: 'https://weather.example.com/docs',
          },
        ],
        docs: { homepage: 'https://weather.example.com', llmsTxt: 'https://weather.example.com/llms.txt' },
      },
      {
        id: 'translate',
        name: 'Translate Service',
        serviceUrl: 'https://translate.example.com',
        description: 'Language translation',
        categories: ['nlp'],
        tags: ['language'],
        endpointCount: 4,
      },
    ],
  }

  function mockFetchOk(body: unknown) {
    return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => body,
    } as Response)
  }

  it('normalizes the service list', async () => {
    mockFetchOk(serviceDirectory)

    const list = await fetchServiceList()
    expect(list).toHaveLength(2)

    const [weather, translate] = list
    expect(weather).toMatchObject({
      id: 'weather',
      name: 'Weather API',
      url: 'https://weather.example.com',
      service_url: 'https://weather.mpp.tempo.xyz',
      supportsCredits: true,
      description: 'Forecasts and current conditions',
      categories: ['data', 'climate'],
      tags: ['forecast', 'meteorology'],
      endpoint_count: 1,
    })

    expect(translate).toMatchObject({
      id: 'translate',
      name: 'Translate Service',
      service_url: 'https://translate.example.com',
      supportsCredits: false,
      categories: ['nlp'],
      tags: ['language'],
      endpoint_count: 4,
    })
    expect(translate).not.toHaveProperty('url')
  })

  it('searches across tags', async () => {
    mockFetchOk(serviceDirectory)
    const results = await fetchServices({ search: 'meteorology' }) as ServiceSummary[]
    expect(results.map((service) => service.id)).toEqual(['weather'])
  })

  it('searches across categories', async () => {
    mockFetchOk(serviceDirectory)
    const results = await fetchServices({ search: 'nlp' }) as ServiceSummary[]
    expect(results.map((service) => service.id)).toEqual(['translate'])
  })

  it('searches across description', async () => {
    mockFetchOk(serviceDirectory)
    const results = await fetchServices({ search: 'translation' }) as ServiceSummary[]
    expect(results.map((service) => service.id)).toEqual(['translate'])
  })

  it('returns the full list when the search is empty', async () => {
    mockFetchOk(serviceDirectory)
    const results = await fetchServices({ search: '   ' })
    expect(results).toHaveLength(2)
  })

  it('looks up a service detail by id', async () => {
    mockFetchOk(serviceDirectory)
    const detail = await fetchServices({ serviceId: 'weather' })
    expect(detail).toMatchObject({
      id: 'weather',
      docs: {
        homepage: 'https://weather.example.com',
        llmsTxt: 'https://weather.example.com/llms.txt',
        openapi: null,
        apiReference: null,
      },
      endpoints: [
        {
          method: 'GET',
          path: '/now',
          description: 'Current weather',
          payment: {
            intent: 'pay',
            amount: '100',
            decimals: 6,
            unitType: 'usdc',
          },
          docs: 'https://weather.example.com/docs',
        },
      ],
    })
  })

  it('throws E_USAGE for an unknown service id', async () => {
    mockFetchOk(serviceDirectory)
    const error = await fetchServices({ serviceId: 'missing' }).catch((e) => e)
    expectUsageError(error, "Configuration missing: service 'missing' not found")
  })

  it('throws when the directory request fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 503 } as Response)
    const error = await fetchServiceList().catch((e) => e)
    expect((error as Error).message).toBe('Failed to fetch service directory: HTTP 503')
  })
})
