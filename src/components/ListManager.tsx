import { useState } from 'react'

interface ListManagerProps {
  title: string
  items: string[]
  onItemsChange: (items: string[]) => void
  placeholder?: string
  helpText?: string
}

export default function ListManager({ title, items, onItemsChange, placeholder = "Enter item", helpText }: ListManagerProps) {
  const [inputValue, setInputValue] = useState('')

  const handleAdd = () => {
    const trimmed = inputValue.trim()
    if (trimmed && !items.includes(trimmed)) {
      onItemsChange([...items, trimmed])
      setInputValue('')
    }
  }

  const handleRemove = (item: string) => {
    onItemsChange(items.filter(i => i !== item))
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAdd()
    }
  }

  return (
    <div>
      <label className="label">
        <span className="label-text">{title}</span>
      </label>
      <div className="flex gap-2 mb-2">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder={placeholder}
          className="input input-bordered input-sm flex-1"
        />
        <button
          onClick={handleAdd}
          className="btn btn-sm btn-primary"
          disabled={!inputValue.trim() || items.includes(inputValue.trim())}
        >
          Add
        </button>
      </div>
      {items.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {items.map((item, index) => (
            <div key={index} className="badge badge-secondary badge-lg gap-2">
              <span>{item}</span>
              <button
                onClick={() => handleRemove(item)}
                className="btn btn-xs btn-circle btn-ghost"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      {helpText && (
        <label className="label">
          <span className="label-text-alt">{helpText}</span>
        </label>
      )}
    </div>
  )
}
