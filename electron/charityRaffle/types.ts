export class Donation {
  flagCode: string
  sponsor: string
  date: string
  location: string
  amount: string
  USDollarAmount: number
  giftAid: number
  message: string
  distributionFlag: string
  distributionStatus: string
  numberOfNetsFunded: number
  numberOfPeopleSaved: number

  constructor(
    flagCode: string,
    sponsor: string,
    date: string,
    location: string,
    amount: string,
    USDollarAmount: number,
    giftAid: number,
    message: string,
    distributionFlag: string,
    distributionStatus: string,
    numberOfNetsFunded: number,
    numberOfPeopleSaved: number
  ) {
    this.flagCode = flagCode
    this.sponsor = sponsor
    this.date = date
    this.location = location
    this.amount = amount
    this.USDollarAmount = USDollarAmount
    this.giftAid = giftAid
    this.message = message
    this.distributionFlag = distributionFlag
    this.distributionStatus = distributionStatus
    this.numberOfNetsFunded = numberOfNetsFunded
    this.numberOfPeopleSaved = numberOfPeopleSaved
  }
}

export type CharityRaffleCredentials = {
  googleServiceAccountEmail: string
  googlePrivateKey: string
  sheetsDbId: string
  fundraiserId: string
  processedSheetOffset: number
  conductorName: string
  strawPollApiKey?: string
  raffleAmount?: number
  raffleDeadline?: number
}

export type YeeOrPepe = 'YEE' | 'PEPE' | 'NONE'

/** Processed sheet entry (from RaffleDashboard). Used for raffle rolls. */
export interface ProcessedDonation {
  NR: number
  inRaffle: boolean
  flag: string
  sponsor: string
  date: number
  location: string
  amount: number
  message: string
  yeeOrPepe: YeeOrPepe
  lastUpdated?: Date
  lastUpdatedBy?: string
}
