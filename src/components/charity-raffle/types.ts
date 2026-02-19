export interface ProcessedDonation {
  NR: number
  inRaffle: boolean
  flag: string
  sponsor: string
  date: number
  location: string
  amount: number
  message: string
  yeeOrPepe: 'YEE' | 'PEPE' | 'NONE'
  lastUpdated?: Date
  lastUpdatedBy?: string
}
