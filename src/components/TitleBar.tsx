import { useState, useEffect, useRef } from 'react'

const MENU_LABELS = ['File', 'Edit', 'View', 'Window', 'Help'] as const

/** Custom title bar for frameless window: menu, drag region, minimize / maximize / close. */
export default function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false)
  const menuButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  useEffect(() => {
    const checkMaximized = () => {
      if (typeof window !== 'undefined' && window.ipcRenderer) {
        window.ipcRenderer.invoke('window-is-maximized').then((max: boolean) => setIsMaximized(!!max))
      }
    }
    checkMaximized()
    window.addEventListener('resize', checkMaximized)
    return () => window.removeEventListener('resize', checkMaximized)
  }, [])

  const minimize = () => window.ipcRenderer?.invoke('window-minimize')
  const maximize = () => {
    window.ipcRenderer?.invoke('window-maximize')
    setIsMaximized((prev) => !prev)
  }
  const close = () => window.ipcRenderer?.invoke('window-close')

  const handleDragRegionDoubleClick = () => {
    window.ipcRenderer?.invoke('window-maximize')
    setIsMaximized((prev) => !prev)
  }

  const openMenu = (label: string) => {
    const el = menuButtonRefs.current[label]
    if (!el || !window.ipcRenderer) return
    const rect = el.getBoundingClientRect()
    window.ipcRenderer.invoke('menu-popup', {
      menuLabel: label,
      clientX: rect.left,
      clientY: rect.bottom,
    })
  }

  if (typeof window !== 'undefined' && !window.ipcRenderer) return null

  return (
    <header
      className="flex items-center justify-between h-8 flex-shrink-0 bg-base-200 border-b border-base-content/10 select-none"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div
        className="flex items-center min-w-0 flex-1"
        onDoubleClick={handleDragRegionDoubleClick}
      >
        <div className="flex items-center pl-3 pr-2 text-sm font-medium text-base-content/80 truncate shrink-0 pointer-events-none">
          Omni Screen
        </div>
        <div
          className="flex items-center h-full gap-0.5"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {MENU_LABELS.map((label) => (
            <button
              key={label}
              ref={(el) => { menuButtonRefs.current[label] = el }}
              type="button"
              className="h-full px-2.5 text-sm text-base-content/80 hover:bg-base-content/10 rounded transition-colors"
              onClick={() => openMenu(label)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div
        className="flex items-center h-full"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          type="button"
          className="h-full w-12 flex items-center justify-center hover:bg-base-content/10 transition-colors"
          onClick={minimize}
          title="Minimize"
          aria-label="Minimize"
        >
          <span className="text-base-content/70 text-lg leading-none">−</span>
        </button>
        <button
          type="button"
          className="h-full w-12 flex items-center justify-center hover:bg-base-content/10 transition-colors"
          onClick={maximize}
          title={isMaximized ? 'Restore' : 'Maximize'}
          aria-label={isMaximized ? 'Restore' : 'Maximize'}
        >
          <span className="text-base-content/70 text-sm leading-none">{isMaximized ? '❐' : '□'}</span>
        </button>
        <button
          type="button"
          className="h-full w-12 flex items-center justify-center hover:bg-error/20 hover:text-error transition-colors"
          onClick={close}
          title="Close"
          aria-label="Close"
        >
          <span className="text-base-content/70 text-lg leading-none">×</span>
        </button>
      </div>
    </header>
  )
}
