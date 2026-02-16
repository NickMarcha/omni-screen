/**
 * Twitch chat send via GQL API (gql.twitch.tv).
 * Resolves channel login → channel ID via Helix, then sends via sendChatMessage mutation.
 * Requires OAuth token (e.g. from auth-token cookie when user is logged in on twitch.tv).
 */

import { fileLogger } from './fileLogger'

const TWITCH_GQL_URL = 'https://gql.twitch.tv/gql'
const TWITCH_HELIX_URL = 'https://api.twitch.tv/helix/users'
const TWITCH_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko'
const TWITCH_CLIENT_VERSION = '31168246-1c5c-40c8-9a25-ed4247b03723'

/** Generate a 32-char hex nonce for sendChatMessage. */
function generateNonce(): string {
  const hex = '0123456789abcdef'
  let out = ''
  for (let i = 0; i < 32; i++) out += hex[Math.floor(Math.random() * 16)]
  return out
}

/** GQL headers for user lookup (same as send, needs OAuth). */
function gqlHeaders(oauthToken: string) {
  const token = oauthToken.startsWith('OAuth ') ? oauthToken.trim() : `OAuth ${oauthToken.trim()}`
  return {
    'Content-Type': 'text/plain;charset=UTF-8',
    Accept: '*/*',
    'Client-Id': TWITCH_CLIENT_ID,
    'Client-Version': TWITCH_CLIENT_VERSION,
    Authorization: token,
    Origin: 'https://www.twitch.tv',
    Referer: 'https://www.twitch.tv/',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0',
  }
}

/**
 * Resolve channel login → channel ID via GQL (same API as send, avoids Helix 404s).
 * Requires oauthToken.
 */
const USER_BY_LOGIN_QUERY = 'query UserByLogin($login: String!) { user(login: $login) { id } }'
const USER_BY_LOGIN_HASH = '99d36284b4393b7bfc4bbfe7b2bfe12a35ff7d1512ed9459e68cdae342d6a366'

async function getChannelIdByLoginGql(
  login: string,
  oauthToken: string
): Promise<{ channelId: string } | { error: string }> {
  const body = {
    operationName: 'UserByLogin',
    variables: { login },
    query: USER_BY_LOGIN_QUERY,
    extensions: {
      persistedQuery: { version: 1, sha256Hash: USER_BY_LOGIN_HASH },
    },
  }
  const res = await fetch(TWITCH_GQL_URL, {
    method: 'POST',
    headers: gqlHeaders(oauthToken),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    fileLogger.writeLog('warn', 'main', '[Twitch] GQL user lookup failed', [
      login,
      res.status,
      errBody?.slice(0, 200) ?? '',
    ])
    return { error: `User lookup failed (${res.status})` }
  }
  const json = (await res.json().catch(() => null)) as { data?: { user?: { id?: string } }; errors?: Array<{ message?: string }> }
  const err = json?.errors?.[0]?.message
  if (err) {
    fileLogger.writeLog('warn', 'main', '[Twitch] GQL user lookup error', [login, err])
    return { error: err }
  }
  const id = json?.data?.user?.id
  if (!id) return { error: 'Channel not found' }
  return { channelId: id }
}

/**
 * Resolve channel login name to numeric channel ID.
 * Uses GQL when OAuth is available (same API as send, avoids Helix 404s).
 * Falls back to Helix when no OAuth (e.g. read-only lookups).
 */
export async function getChannelIdByLogin(
  login: string,
  oauthToken?: string
): Promise<{ channelId: string } | { error: string }> {
  const normalized = String(login || '').trim().toLowerCase().replace(/^#/, '')
  if (!normalized) return { error: 'Missing channel login' }

  if (oauthToken) {
    const gqlResult = await getChannelIdByLoginGql(normalized, oauthToken)
    if (!('error' in gqlResult)) return gqlResult
    fileLogger.writeLog('warn', 'main', '[Twitch] GQL user lookup failed, trying Helix', [
      normalized,
      gqlResult.error,
    ])
  }

  const url = `${TWITCH_HELIX_URL}?login=${encodeURIComponent(normalized)}`
  const headers: Record<string, string> = {
    'Client-Id': TWITCH_CLIENT_ID,
    Accept: 'application/json',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0',
  }
  if (oauthToken) {
    const token = oauthToken.startsWith('OAuth ') ? oauthToken.slice(6).trim() : oauthToken.trim()
    if (token) headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(url, { method: 'GET', headers })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    fileLogger.writeLog('warn', 'main', '[Twitch] Helix lookup failed', [
      normalized,
      res.status,
      body?.slice(0, 300) ?? '',
      oauthToken ? 'had OAuth' : 'no OAuth',
    ])
    return { error: `Helix lookup failed (${res.status})` }
  }
  const json = (await res.json().catch(() => null)) as { data?: Array<{ id?: string }> }
  const id = json?.data?.[0]?.id
  if (!id) return { error: 'Channel not found' }
  return { channelId: id }
}

/**
 * Send a chat message to a channel via Twitch GQL sendChatMessage.
 * oauthToken: plain token (e.g. from auth-token cookie), used as "OAuth <token>" in Authorization header.
 */
export async function sendChatMessage(
  oauthToken: string,
  channelId: string,
  message: string
): Promise<{ success: boolean; error?: string }> {
  const token = String(oauthToken || '').trim()
  if (!token) return { success: false, error: 'Not logged in to Twitch (add cookies in Connections)' }
  const trimmed = String(message || '').trim()
  if (!trimmed) return { success: false, error: 'Message is empty' }

  const body = {
    operationName: 'sendChatMessage',
    variables: {
      input: {
        channelID: String(channelId),
        message: trimmed,
        nonce: generateNonce(),
        replyParentMessageID: null,
      },
    },
    extensions: {
      persistedQuery: {
        version: 1,
        sha256Hash: '0435464292cf380ed4b3d905e4edcb73078362e82c06367a5b2181c76c822fa2',
      },
    },
  }

  const res = await fetch(TWITCH_GQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=UTF-8',
      Accept: '*/*',
      'Client-Id': TWITCH_CLIENT_ID,
      'Client-Version': TWITCH_CLIENT_VERSION,
      Authorization: token.startsWith('OAuth ') ? token : `OAuth ${token}`,
      Origin: 'https://www.twitch.tv',
      Referer: 'https://www.twitch.tv/',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    fileLogger.writeLog('warn', 'main', '[Twitch] GQL send failed', [
      channelId,
      res.status,
      errBody?.slice(0, 300) ?? '',
    ])
    return { success: false, error: `Send failed (${res.status})` }
  }

  const json = (await res.json().catch(() => null)) as {
    data?: { sendChatMessage?: { dropReason?: string; message?: { id?: string }; __typename?: string } }
    errors?: Array<{ message?: string }>
  }
  const err = json?.errors?.[0]?.message ?? json?.data?.sendChatMessage?.dropReason
  if (err) {
    fileLogger.writeLog('warn', 'main', '[Twitch] GQL send rejected', [channelId, err])
    return { success: false, error: String(err) }
  }
  return { success: true }
}
