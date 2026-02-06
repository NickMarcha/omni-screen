const OMNI_PALETTE = [
  '#7dcf67', // destiny kick
  '#8450c5', // random
  '#ccb55d', // random
  '#cc5e9c', // random
  '#55633d', // random
  '#be5640', // destiny youtube
  '#94b3c3', // dgg
  '#533958', // random
] as const

export type OmniColor = (typeof OMNI_PALETTE)[number]

const COLOR_DGG: OmniColor = '#94b3c3'
const COLOR_DESTINY_KICK: OmniColor = '#7dcf67'
const COLOR_DESTINY_YOUTUBE: OmniColor = '#be5640'

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
  },
): OmniColor {
  const k = String(key || '').toLowerCase()
  if (!k) return NON_RESERVED[0]

  if (k === 'dgg' || k.startsWith('dgg:')) return COLOR_DGG

  // Special-case Destiny's Kick channel
  if (k === 'kick:destiny') return COLOR_DESTINY_KICK

  // Special-case Destiny on YouTube when the stream/channel name indicates Destiny.
  // (YouTube "id" is usually a videoId; displayName is the best signal we have.)
  const dn = String(opts?.displayName || '').trim().toLowerCase()
  if (k.startsWith('youtube:') && (k === 'youtube:destiny' || dn === 'destiny')) return COLOR_DESTINY_YOUTUBE

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

