const OMNI_PALETTE = [
  '#7dcf67', // reserved
  '#8450c5', // random
  '#ccb55d', // random
  '#cc5e9c', // random
  '#55633d', // random
  '#be5640', // reserved
  '#94b3c3', // primary chat source
  '#533958', // random
] as const

export type OmniColor = (typeof OMNI_PALETTE)[number]

/** Color for primary chat source when key matches opts.primaryChatSourceId. */
const COLOR_PRIMARY_CHAT: OmniColor = '#94b3c3'

/** Default color when a bookmarked streamer has no dock/platform color set. Not from the random palette. */
export const COLOR_BOOKMARKED_DEFAULT = '#6b7280'

const NON_RESERVED: OmniColor[] = [
  '#8450c5',
  '#ccb55d',
  '#cc5e9c',
  '#55633d',
  '#533958',
]

function djb2(str: string): number {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i)
  }
  // Force unsigned 32-bit
  return hash >>> 0
}

export function omniColorForKey(
  key: string,
  opts?: {
    displayName?: string
    /** When set, this key (and key:) gets the primary chat source color. */
    primaryChatSourceId?: string | null
  },
): OmniColor {
  const k = String(key || '').toLowerCase()
  if (!k) return NON_RESERVED[0]

  const primaryId = opts?.primaryChatSourceId?.toLowerCase()
  if (primaryId && (k === primaryId || k.startsWith(primaryId + ':'))) return COLOR_PRIMARY_CHAT

  const idx = djb2(k) % NON_RESERVED.length
  return NON_RESERVED[idx] || NON_RESERVED[0]
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const h = hex.replace('#', '').trim()
  if (h.length !== 6) return null
  const r = Number.parseInt(h.slice(0, 2), 16)
  const g = Number.parseInt(h.slice(2, 4), 16)
  const b = Number.parseInt(h.slice(4, 6), 16)
  if (![r, g, b].every((n) => Number.isFinite(n))) return null
  return { r, g, b }
}

export function withAlpha(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex)
  const a = Math.max(0, Math.min(1, alpha))
  if (!rgb) return `rgba(0,0,0,${a})`
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})`
}

export function textColorOn(hex: string): '#000' | '#fff' {
  const rgb = hexToRgb(hex)
  if (!rgb) return '#fff'
  // perceived luminance
  const lum = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255
  return lum > 0.55 ? '#000' : '#fff'
}

