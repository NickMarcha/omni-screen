/**
 * Charity raffle IPC handlers. Two scrape modes:
 * - Single-page: for status updates (distribution status changes; run every 15 min)
 * - Multi-page: full catch-up, loops until sheet has all donations
 */
import type { IpcMain } from 'electron'
import { getCredentials, setCredentials } from './store.js'
import { DonationsScraper, scrapeSinglePage } from './scrapeAgainstMalaria.js'
import {
  instantiate,
  updateLatest,
  saveUpdated,
  setEntryToPlayed,
  fetchTotal,
} from './googleSheets.js'
import { rollRaffle, rollRaffles } from './raffleLogic.js'
import type { CharityRaffleCredentials } from './types.js'
import { fileLogger } from '../fileLogger.js'

function log(level: 'info' | 'warn' | 'error', msg: string, args: unknown[] = []) {
  try {
    fileLogger.writeLog(level, 'main', `[CharityRaffle] ${msg}`, args)
  } catch {
    /* ignore */
  }
}

export function registerCharityRaffleHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('charity-raffle-get-credentials', () => {
    return getCredentials()
  })

  ipcMain.handle('charity-raffle-save-credentials', (_event, creds: Partial<CharityRaffleCredentials>) => {
    setCredentials(creds)
    return { ok: true }
  })

  /** Single-page scrape: status updates only (distribution status changes over time) */
  ipcMain.handle('charity-raffle-run-scrape-single', async () => {
    log('info', 'Run scrape (single page) requested', [])

    const creds = getCredentials()
    if (!creds.googleServiceAccountEmail || !creds.googlePrivateKey?.trim()) {
      log('warn', 'Scrape aborted: missing email or private key', [])
      return { ok: false, error: 'Google service account email and private key are required' }
    }
    if (!creds.sheetsDbId?.trim()) {
      log('warn', 'Scrape aborted: missing Sheets DB ID', [])
      return { ok: false, error: 'Sheets database ID is required' }
    }

    const fundraiserId = creds.fundraiserId?.trim() || '8960'
    log('info', 'Starting single-page scrape', [{ fundraiserId }])

    try {
      await instantiate(creds)
      const data = await scrapeSinglePage(fundraiserId)

      if (data.donations.length === 0) {
        log('info', 'No donations to add, skipping Sheets update', [])
        return { ok: true, donationsCount: 0, message: 'No new donations to add' }
      }

      const start = data.totalDonations - data.endSponsorCount
      const end = data.totalDonations - data.startSponsorCount
      log('info', 'Updating RawData sheet', [{ start, end }])
      await updateLatest(data.donations, start, end)

      log('info', 'Single-page scrape finished', [{ donationsCount: data.donations.length }])
      return { ok: true, donationsCount: data.donations.length, totalDonations: data.totalDonations }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log('error', 'Scrape failed', [message])
      return { ok: false, error: message }
    }
  })

  async function runScrapeFull(): Promise<{ ok: boolean; donationsCount?: number; totalDonations?: number; error?: string }> {
    const creds = getCredentials()
    if (!creds.googleServiceAccountEmail || !creds.googlePrivateKey?.trim()) {
      return { ok: false, error: 'Google service account email and private key are required' }
    }
    if (!creds.sheetsDbId?.trim()) {
      return { ok: false, error: 'Sheets database ID is required' }
    }
    const fundraiserId = creds.fundraiserId?.trim() || '8960'
    log('info', 'Instantiating Google Sheets client', [])
    await instantiate(creds)
    log('info', 'Launching Puppeteer scrape (multi-page)', [])
    const ds = await DonationsScraper.createScraper(fundraiserId, -1)
    const totalDonations = ds.totalDonationsCount
    let totalDonationsWritten = 0
    do {
      const donationBatch = await ds.donationBatch()
      if (donationBatch.donations.length > 0) {
        const start = totalDonations - donationBatch.endSponsorCount
        const end = totalDonations - donationBatch.startSponsorCount
        await updateLatest(donationBatch.donations, start, end)
        totalDonationsWritten += donationBatch.donations.length
      }
    } while (await ds.goToNextPage())
    await ds.close()
    return { ok: true, donationsCount: totalDonationsWritten, totalDonations }
  }

  /** Multi-page scrape: full catch-up, loops until sheet has all donations */
  ipcMain.handle('charity-raffle-run-scrape-full', async () => {
    log('info', 'Run scrape (full) requested', [])
    try {
      const result = await runScrapeFull()
      if (result.ok) {
        log('info', 'Scrape finished', [{ totalDonationsWritten: result.donationsCount }])
      }
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log('error', 'Scrape failed', [message])
      return { ok: false, error: message }
    }
  })

  ipcMain.handle('charity-raffle-run-scrape', async () => runScrapeFull())

  // Raffle
  ipcMain.handle('charity-raffle-instantiate', async () => {
    const creds = getCredentials()
    if (!creds.sheetsDbId?.trim()) return { ok: false, error: 'Sheets DB ID required' }
    try {
      await instantiate(creds)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('charity-raffle-fetch-total', async () => {
    try {
      return await fetchTotal(false)
    } catch (err) {
      return null
    }
  })

  ipcMain.handle('charity-raffle-roll', async () => {
    try {
      const creds = getCredentials()
      if (!creds.sheetsDbId?.trim()) return { ok: false, winner: null, error: 'Sheets DB ID required' }
      await instantiate(creds)
      const conductorName = creds.conductorName?.trim() || 'omni-screen'
      const winner = await rollRaffle(conductorName)
      return { ok: true, winner }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log('error', 'Roll failed', [msg])
      return { ok: false, winner: null, error: msg }
    }
  })

  ipcMain.handle('charity-raffle-roll-more', async (_event, amount: number) => {
    try {
      const creds = getCredentials()
      if (!creds.sheetsDbId?.trim()) return { ok: false, winners: [], error: 'Sheets DB ID required' }
      await instantiate(creds)
      const winners = await rollRaffles(amount)
      return { ok: true, winners }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log('error', 'Roll more failed', [msg])
      return { ok: false, winners: [], error: msg }
    }
  })

  ipcMain.handle('charity-raffle-set-entry-played', async (_event, entryId: number, lazy: boolean = false) => {
    try {
      const creds = getCredentials()
      if (!creds.sheetsDbId?.trim()) return { ok: false, error: 'Sheets DB ID required' }
      await instantiate(creds)
      const conductorName = creds.conductorName?.trim() || 'omni-screen'
      await setEntryToPlayed(entryId, conductorName, lazy)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('charity-raffle-save-updated', async () => {
    try {
      await saveUpdated()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}
