import { Errors } from 'incur'

export function usageError(message: string) {
  return new Errors.IncurError({ code: 'E_USAGE', message, exitCode: 2 })
}

export function networkError(message: string) {
  return new Errors.IncurError({ code: 'E_NETWORK', message, exitCode: 3 })
}
