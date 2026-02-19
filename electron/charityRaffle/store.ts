import Store from 'electron-store'
import type { CharityRaffleCredentials } from './types.js'

const CREDENTIALS_KEY = 'omni-screen:charity-raffle-credentials'

const defaultCredentials: CharityRaffleCredentials = {
  googleServiceAccountEmail: '',
  googlePrivateKey: '',
  sheetsDbId: '',
  fundraiserId: '8960',
  processedSheetOffset: 2,
}

let store: Store | null = null

function getStore(): Store {
  if (!store) {
    store = new Store()
  }
  return store
}

export function getCredentials(): CharityRaffleCredentials {
  const raw = getStore().get(CREDENTIALS_KEY)
  if (raw && typeof raw === 'object') {
    return { ...defaultCredentials, ...raw } as CharityRaffleCredentials
  }
  return { ...defaultCredentials }
}

export function setCredentials(creds: Partial<CharityRaffleCredentials>): void {
  const current = getCredentials()
  const next = { ...current, ...creds }
  getStore().set(CREDENTIALS_KEY, next)
}
