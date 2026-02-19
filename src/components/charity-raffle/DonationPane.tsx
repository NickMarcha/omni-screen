import { RenderClickableMessage, fromSerialDate, getFlagUrl } from './utils'
import type { ProcessedDonation } from './types'

interface ProcessedDonationUI extends ProcessedDonation {
  lastUpdated?: Date
}

export default function DonationPane({ donation }: { donation: ProcessedDonationUI | null }) {
  if (!donation) return null
  const formattedTimeStamp = donation.lastUpdated ? new Date(donation.lastUpdated).toLocaleString() : undefined
  return (
    <div className="flex rounded overflow-hidden m-2 w-96 border-2 bg-base-200">
      <div className="p-2 flex-1">
        <div><strong>Sponsor:</strong><br />{donation.sponsor}</div>
        <div>
          <strong>Location:</strong><br />
          <span className="flex items-center gap-1">
            <img className="h-4 w-5" title={`${donation.flag} - ${donation.location}`} src={getFlagUrl(donation.flag)} alt="" />
            {donation.location}
          </span>
        </div>
        <div><strong>Amount:</strong><br />$ {donation.amount}</div>
        {formattedTimeStamp ? (
          <div><strong>Timestamp:</strong><br />{formattedTimeStamp}</div>
        ) : (
          <div><strong>Date:</strong><br />{fromSerialDate(donation.date)}</div>
        )}
      </div>
      <div className="p-2 border-l-2 flex-1">
        <RenderClickableMessage message={donation.message} />
      </div>
    </div>
  )
}
