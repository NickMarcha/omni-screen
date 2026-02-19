import { useState } from 'react'

export function useArray<T>(defaultValue: T[]) {
  const [array, setArray] = useState(defaultValue)
  return {
    array,
    set: setArray,
    update: (index: number, newElement: T) => {
      setArray((a) => [...a.slice(0, index), newElement, ...a.slice(index + 1)])
    },
    clear: () => setArray([]),
  }
}
