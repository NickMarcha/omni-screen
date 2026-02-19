/**
 * Raffle roll logic. Ported from RaffleDashboard.
 * Weighted random selection by donation amount.
 */
import type { ProcessedDonation } from './types.js'
import {
  fetchValidRaffleEntries,
  fetchEntryByID,
  setEntryTimeStamp,
  saveUpdated,
} from './googleSheets.js'
import { fileLogger } from '../fileLogger.js'

const LAZY_DEFAULT = false

function log(level: 'info' | 'warn' | 'error', msg: string, args: unknown[] = []) {
  try {
    fileLogger.writeLog(level, 'main', `[CharityRaffle] ${msg}`, args)
  } catch {
    /* ignore */
  }
}

/** Single raffle roll: pick winner, set timestamp, save. Returns winner. */
export async function rollRaffle(conductorName: string): Promise<ProcessedDonation | null> {
  const validRaffleEntries = await fetchValidRaffleEntries(!LAZY_DEFAULT)
  if (validRaffleEntries.length === 0) {
    log('warn', 'No valid raffle entries', [])
    return null
  }

  const max = validRaffleEntries[validRaffleEntries.length - 1].rollingSum
  const random = Math.floor(Math.random() * max)
  let winnerIdx: number | undefined

  for (let i = 0; i < validRaffleEntries.length; i++) {
    if (random < validRaffleEntries[i].rollingSum) {
      winnerIdx = i
      break
    }
  }

  if (winnerIdx === undefined) {
    log('error', 'Roll failed: no winner determined', [])
    return null
  }

  const winnerNR = validRaffleEntries[winnerIdx].nr
  log('info', 'Raffle winner', [{ winnerNR }])

  const winnerData = await fetchEntryByID(winnerNR, true)
  await setEntryTimeStamp(winnerNR, conductorName, LAZY_DEFAULT)
  await saveUpdated()

  return winnerData
}

/** Roll N winners without writing to sheet. For RaffleMoreV2 poll. */
export async function rollRaffles(amount: number): Promise<ProcessedDonation[]> {
  const validRaffleEntries = await fetchValidRaffleEntries(!LAZY_DEFAULT)
  if (validRaffleEntries.length === 0) return []

  const max = validRaffleEntries[validRaffleEntries.length - 1].rollingSum
  const winners: number[] = []

  while (winners.length < amount) {
    const random = Math.floor(Math.random() * max)
    for (let i = 0; i < validRaffleEntries.length; i++) {
      if (random < validRaffleEntries[i].rollingSum) {
        if (!winners.includes(i)) winners.push(i)
        break
      }
    }
  }

  const winnerIDs = winners.map((w) => validRaffleEntries[w].nr)
  const fetches = winnerIDs.map((id) => fetchEntryByID(id, true))
  return Promise.all(fetches)
}
