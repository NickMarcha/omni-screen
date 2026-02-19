import { JWT } from 'google-auth-library'
import { GoogleSpreadsheet, type GoogleSpreadsheetWorksheet } from 'google-spreadsheet'
import type { Donation } from './types.js'
import type { CharityRaffleCredentials } from './types.js'
import { fileLogger } from '../fileLogger.js'

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
]

const RAW_DATA_OFFSET = 3 // Header rows in RawData sheet

/**
 * Normalize private key for PEM parsing. Handles:
 * - JSON-style escaped newlines (\\n -> real newline)
 * - Leading/trailing whitespace and quotes
 * - Keys pasted as single line (insert newlines every 64 chars in base64 section)
 */
function normalizePrivateKey(raw: string): string | null {
  let key = raw.trim()
  if (!key) return null

  // Strip surrounding quotes if pasted from JSON
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1)
  }

  // Replace escaped newlines (from JSON) with real newlines
  key = key.replace(/\\n/g, '\n')
  key = key.replace(/\r\n/g, '\n')

  if (!key.includes('-----BEGIN PRIVATE KEY-----')) {
    return null
  }

  // Ensure newline after -----BEGIN PRIVATE KEY----- (fixes single-line paste)
  const beginMarker = '-----BEGIN PRIVATE KEY-----'
  const beginIdx = key.indexOf(beginMarker)
  const afterBegin = beginIdx + beginMarker.length
  if (key[afterBegin] !== '\n' && key[afterBegin] !== '\r' && key[afterBegin] !== undefined) {
    key = key.slice(0, afterBegin) + '\n' + key.slice(afterBegin)
  }

  // Ensure newline before -----END PRIVATE KEY-----
  const endMarker = '-----END PRIVATE KEY-----'
  const endIdx = key.indexOf(endMarker)
  if (endIdx > 0 && key[endIdx - 1] !== '\n' && key[endIdx - 1] !== '\r') {
    key = key.slice(0, endIdx) + '\n' + key.slice(endIdx)
  }

  return key
}

function log(level: 'info' | 'warn' | 'error', msg: string, args: unknown[] = []) {
  try {
    fileLogger.writeLog(level, 'main', `[CharityRaffle] ${msg}`, args)
  } catch {
    /* ignore */
  }
}

let doc: GoogleSpreadsheet | null = null
let rawDataSheet: GoogleSpreadsheetWorksheet | null = null

export async function instantiate(creds: CharityRaffleCredentials): Promise<void> {
  log('info', 'Instantiating Google Sheets', [])

  const { googleServiceAccountEmail, googlePrivateKey, sheetsDbId } = creds

  if (!googleServiceAccountEmail || !googlePrivateKey || !sheetsDbId) {
    log('error', 'Missing credentials', [])
    throw new Error('Missing Google Sheets credentials')
  }

  const key = normalizePrivateKey(googlePrivateKey)
  if (!key) {
    log('error', 'Private key normalization failed', [])
    throw new Error('Invalid private key: must start with -----BEGIN PRIVATE KEY-----')
  }

  log('info', 'Creating JWT auth', [{ email: googleServiceAccountEmail }])
  const jwt = new JWT({
    email: googleServiceAccountEmail,
    key,
    scopes: SCOPES,
  })

  const mainId = String(sheetsDbId).trim().replace(/\/+$/, '')
  if (!mainId) {
    throw new Error('Spreadsheet ID cannot be empty')
  }

  doc = new GoogleSpreadsheet(mainId, jwt)

  log('info', 'Loading main doc', [{ mainId }])
  try {
    await doc.loadInfo()
    log('info', 'Main doc loaded', [{ title: doc.title }])
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log('error', 'Main doc load failed', [msg])
    throw new Error(`Sheets DB (main doc with RawData) not found. Check "Sheets DB ID". ${msg}`)
  }

  rawDataSheet = doc.sheetsByTitle['RawData'] ?? doc.sheetsByTitle['Raw Data']
  if (!rawDataSheet) {
    log('error', 'RawData sheet not found', [{ availableSheets: Object.keys(doc.sheetsByTitle) }])
    throw new Error('RawData sheet not found (tried "RawData" and "Raw Data")')
  }
  log('info', 'Found RawData sheet', [{ rowCount: rawDataSheet.rowCount, columnCount: rawDataSheet.columnCount }])

  await rawDataSheet.loadCells()
  log('info', 'RawData sheet cells loaded', [])
}

export async function updateLatest(
  scrapedEntries: Donation[],
  fromSponsors: number,
  toSponsors: number
): Promise<void> {
  if (!rawDataSheet) {
    throw new Error('Sheets not instantiated')
  }

  const start = fromSponsors + RAW_DATA_OFFSET
  const endRow = toSponsors + RAW_DATA_OFFSET
  const range = `A${start}:M${endRow}`

  await rawDataSheet.loadCells(range)

  scrapedEntries.reverse().forEach((entry, index) => {
    const row = index + start
    rawDataSheet!.getCellByA1(`A${row}`).numberValue = 1 + row - RAW_DATA_OFFSET
    rawDataSheet!.getCellByA1(`B${row}`).value = entry.flagCode
    rawDataSheet!.getCellByA1(`C${row}`).value = entry.sponsor
    rawDataSheet!.getCellByA1(`D${row}`).value = entry.date
    rawDataSheet!.getCellByA1(`E${row}`).value = entry.location
    rawDataSheet!.getCellByA1(`F${row}`).value = entry.amount
    rawDataSheet!.getCellByA1(`G${row}`).numberValue = entry.USDollarAmount
    rawDataSheet!.getCellByA1(`H${row}`).numberValue = entry.giftAid
    rawDataSheet!.getCellByA1(`I${row}`).value = entry.message
    rawDataSheet!.getCellByA1(`J${row}`).value = entry.distributionFlag
    rawDataSheet!.getCellByA1(`K${row}`).value = entry.distributionStatus
    rawDataSheet!.getCellByA1(`L${row}`).numberValue = entry.numberOfNetsFunded
    rawDataSheet!.getCellByA1(`M${row}`).numberValue = entry.numberOfPeopleSaved
  })

  await rawDataSheet.saveUpdatedCells()
  log('info', 'Cells saved to Sheets', [{ rowsWritten: scrapedEntries.length }])
}
