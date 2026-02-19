import { useCountdown } from './hooks/useCountdown'

export default function CountdownTimer({ targetDate }: { targetDate: Date }) {
  const [days, hours, minutes, seconds] = useCountdown(targetDate)
  if (days + hours + minutes + seconds <= 0) {
    return <div className="text-lg">Loading poll results...</div>
  }
  return (
    <div className="flex gap-2">
      {days > 0 && <span>{days}d</span>}
      {hours > 0 && <span>{hours}h</span>}
      <span>{minutes}m</span>
      <span className={minutes < 1 && seconds < 20 ? 'text-error' : ''}>{seconds}s</span>
    </div>
  )
}
