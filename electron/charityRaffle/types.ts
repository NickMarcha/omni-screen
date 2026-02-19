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
}
