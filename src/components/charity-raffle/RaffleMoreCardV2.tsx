import { RenderClickableMessage, fromSerialDate } from './utils'
import type { ProcessedDonation } from './types'

interface Props {
  dono: ProcessedDonation
  isChecked: boolean
  setToggleState: (v: boolean) => void
  disabled: boolean
  removing: boolean
}

export default function RaffleMoreCardV2({ dono, isChecked, setToggleState, disabled, removing }: Props) {
  const fdate = dono.date ? fromSerialDate(dono.date) : ''
  return (
    <div className={`max-w-sm p-4 rounded-lg border-2 ${removing ? 'border-error' : 'border-primary'}`}>
      <div className="flex justify-between items-center">
        <h5 className="font-bold">{dono.sponsor}</h5>
        <input
          type="checkbox"
          checked={isChecked}
          disabled={disabled}
          onChange={(e) => setToggleState(e.target.checked)}
          className="checkbox checkbox-primary"
        />
      </div>
      <div className="mt-2 break-words">
        <RenderClickableMessage message={dono.message} />
      </div>
      <div className="flex justify-between mt-2 text-sm opacity-80">
        <span>${dono.amount}</span>
        <span>{dono.location}</span>
        <span>{fdate}</span>
      </div>
    </div>
  )
}
