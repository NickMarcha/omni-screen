import type { IpcMain } from 'electron'
import { getCredentials, setCredentials } from './store.js'
import { DonationsScraper } from './scrapeAgainstMalaria.js'
import { instantiate, updateLatest } from './googleSheets.js'
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

  ipcMain.handle('charity-raffle-run-scrape', async () => {
    log('info', 'Run scrape requested', [])

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
    log('info', 'Starting scrape', [{ fundraiserId, sheetsDbId: creds.sheetsDbId?.slice(0, 12) + '...' }])

    try {
      log('info', 'Instantiating Google Sheets client', [])
      await instantiate(creds)

      log('info', 'Launching Puppeteer scrape (multi-page)', [])
      const ds = await DonationsScraper.createScraper(fundraiserId, -1)
      const totalDonations = ds.totalDonationsCount

      let totalDonationsWritten = 0
      do {
        const donationBatch = await ds.donationBatch()
        log('info', 'Batch fetched', [{
          donationsCount: donationBatch.donations.length,
          pageCount: donationBatch.pageCount,
          start: donationBatch.startSponsorCount,
          end: donationBatch.endSponsorCount,
        }])

        if (donationBatch.donations.length > 0) {
          const start = totalDonations - donationBatch.endSponsorCount
          const end = totalDonations - donationBatch.startSponsorCount
          log('info', 'Updating RawData sheet', [{ start, end, rowRange: `rows ${start} to ${end}` }])
          await updateLatest(donationBatch.donations, start, end)
          totalDonationsWritten += donationBatch.donations.length
        }
      } while (await ds.goToNextPage())

      await ds.close()

      log('info', 'Scrape and Sheets update finished successfully', [{ totalDonationsWritten, totalDonations }])
      return {
        ok: true,
        donationsCount: totalDonationsWritten,
        totalDonations,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const stack = err instanceof Error ? err.stack : undefined
      log('error', 'Scrape failed', [message, stack])
      return { ok: false, error: message }
    }
  })
}
