import type { ProtocolHandleResult } from './extensions/types.js'
import { installFromManifestUrl } from './extensions/storage.js'

export type { ProtocolHandleResult }

const PROTOCOL_SCHEME = 'omnichat'

export interface UrlHandlerContext {
  /** Notify renderer of protocol result (e.g. install success). */
  sendProtocolResult?: (result: ProtocolHandleResult) => void
}

/**
 * Parse a protocol URL (omnichat://operation?param=value).
 * Returns { operation, params } or null if invalid.
 */
export function parseProtocolUrl(url: string): { operation: string; params: Record<string, string> } | null {
  if (!url || typeof url !== 'string') return null
  let toParse = url.trim()
  const scheme = `${PROTOCOL_SCHEME}:`
  if (!toParse.toLowerCase().startsWith(scheme)) return null
  toParse = toParse.slice(scheme.length)
  if (toParse.startsWith('//')) toParse = toParse.slice(2)
  const [pathPart, searchPart] = toParse.split('?')
  const operation = (pathPart || '').replace(/^\/+/, '').replace(/\/+$/, '').trim() || 'open'
  const params: Record<string, string> = {}
  if (searchPart) {
    for (const pair of searchPart.split('&')) {
      const [key, value] = pair.split('=')
      if (key) {
        try {
          let v = value ? decodeURIComponent(value.replace(/\+/g, ' ')) : ''
          // Strip trailing punctuation that can slip in from HTML (e.g. "value)">link</a>")
          v = v.replace(/[)\]\s]+$/, '')
          params[decodeURIComponent(key)] = v
        } catch {
          params[key] = value ?? ''
        }
      }
    }
  }
  return { operation, params }
}

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/

/**
 * Build a bookmarked streamer object from protocol query params.
 * Params: nickname, youtube, kick, twitch, color, youtubeColor, kickColor, twitchColor, openWhenLive, hideLabel.
 */
function buildStreamerFromParams(params: Record<string, string>): Record<string, unknown> {
  const nickname = (params.nickname || params.nick || '').trim() || 'Unnamed'
  const youtube = (params.youtube || params.youtubeChannelId || '').trim() || undefined
  const kick = (params.kick || params.kickSlug || '').trim().toLowerCase() || undefined
  const twitch = (params.twitch || params.twitchLogin || '').trim().toLowerCase() || undefined
  const color = (params.color || '').trim()
  const youtubeColor = (params.youtubeColor || '').trim()
  const kickColor = (params.kickColor || '').trim()
  const twitchColor = (params.twitchColor || '').trim()
  const openWhenLive = params.openWhenLive !== undefined
    ? (params.openWhenLive === '1' || params.openWhenLive === 'true')
    : true
  const hideLabel = params.hideLabel !== undefined
    ? (params.hideLabel === '1' || params.hideLabel === 'true')
    : undefined

  if (!youtube && !kick && !twitch) {
    throw new Error('At least one platform (youtube, kick, or twitch) is required')
  }

  const streamer: Record<string, unknown> = {
    id: `streamer-${Date.now()}`,
    nickname,
    openWhenLive,
  }
  if (youtube) streamer.youtubeChannelId = youtube
  if (kick) streamer.kickSlug = kick
  if (twitch) streamer.twitchLogin = twitch
  if (HEX_COLOR.test(color)) streamer.color = color
  if (HEX_COLOR.test(youtubeColor)) streamer.youtubeColor = youtubeColor
  if (HEX_COLOR.test(kickColor)) streamer.kickColor = kickColor
  if (HEX_COLOR.test(twitchColor)) streamer.twitchColor = twitchColor
  if (hideLabel === true) streamer.hideLabelInCombinedChat = true

  return streamer
}

/**
 * Handle a protocol URL and return the result.
 * Operations: install (param: url = manifest URL), add-streamer (params: nickname, youtube, kick, twitch, colors, flags).
 */
export async function handleProtocolUrl(url: string, context?: UrlHandlerContext): Promise<ProtocolHandleResult> {
  const parsed = parseProtocolUrl(url)
  if (!parsed) {
    return { ok: false, operation: 'unknown', message: 'Invalid URL' }
  }
  const { operation, params } = parsed

  switch (operation.toLowerCase()) {
    case 'install': {
      const manifestUrl = params.url || params.manifest
      if (!manifestUrl) {
        return { ok: false, operation: 'install', message: 'Missing url or manifest parameter' }
      }
      const result = await installFromManifestUrl(manifestUrl)
      if (result.ok && result.id) {
        const out: ProtocolHandleResult = { ok: true, operation: 'install', extensionId: result.id }
        context?.sendProtocolResult?.(out)
        return out
      }
      const fail: ProtocolHandleResult = { ok: false, operation: 'install', message: result.error }
      context?.sendProtocolResult?.(fail)
      return fail
    }
    case 'add-streamer':
    case 'bookmark': {
      try {
        const streamer = buildStreamerFromParams(params)
        const out: ProtocolHandleResult = { ok: true, operation: 'add-streamer', streamer }
        context?.sendProtocolResult?.(out)
        return out
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Invalid add-streamer params'
        const fail: ProtocolHandleResult = { ok: false, operation: 'add-streamer', message }
        context?.sendProtocolResult?.(fail)
        return fail
      }
    }
    default:
      return { ok: false, operation, message: `Unknown operation: ${operation}` }
  }
}

export { PROTOCOL_SCHEME }
