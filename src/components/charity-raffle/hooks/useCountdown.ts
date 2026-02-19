import { useEffect, useState } from 'react'

export function useCountdown(targetDate: Date): [number, number, number, number] {
  const countDownDate = targetDate.getTime()
  const [countDown, setCountDown] = useState(countDownDate - Date.now())

  useEffect(() => {
    const interval = setInterval(() => setCountDown(countDownDate - Date.now()), 1000)
    return () => clearInterval(interval)
  }, [countDownDate])

  const days = Math.floor(countDown / (1000 * 60 * 60 * 24))
  const hours = Math.floor((countDown % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
  const minutes = Math.floor((countDown % (1000 * 60 * 60)) / (1000 * 60))
  const seconds = Math.floor((countDown % (1000 * 60)) / 1000)
  return [days, hours, minutes, seconds]
}
