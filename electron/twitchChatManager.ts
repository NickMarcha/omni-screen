import WebSocket from 'ws'
import { EventEmitter } from 'events'
import { fileLogger } from './fileLogger'

export type TwitchChatMessage = {
  platform: 'twitch'
  channel: string
  id: string
  tmiSentTs?: number
  color?: string
  displayName: string
  userId?: string
  text: string
}

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function safeLower(s: string) {
  return String(s || '').trim().toLowerCase()
}

function parseIrcTags(tagStr: string): Record<string, string> {
  const out: Record<string, string> = {}
  const parts = tagStr.split(';')
  for (const p of parts) {
    if (!p) continue
    const eq = p.indexOf('=')
    if (eq < 0) out[p] = ''
    else out[p.slice(0, eq)] = p.slice(eq + 1)
  }
  return out
}

function splitLines(data: WebSocket.Data): string[] {
  const raw = data.toString()
  // ws frames can contain multiple lines
  return raw.split('\r\n').filter(Boolean)
}

/** Strip IRC prefix (@ mod, + voice) from nick. */
function stripNickPrefix(nick: string): string {
  const s = String(nick || '').trim()
  if (s.startsWith('@') || s.startsWith('+')) return s.slice(1)
  return s
}

export class TwitchChatManager extends EventEmitter {
  private ws: WebSocket | null = null
  private desiredChannels = new Set<string>()
  private joinedChannels = new Set<string>()
  private reconnectTimer: NodeJS.Timeout | null = null
  private intentionallyClosed = false
  private nick: string = `justinfan${randInt(10000, 999999)}`

  private url = 'wss://irc-ws.chat.twitch.tv/'

  /** Chatters per channel (from 353/366, JOIN/PART). */
  private chattersByChannel = new Map<string, Set<string>>()
  /** Last message type per channel: '353' | '366' - used to detect new NAMES batch. */
  private lastNamesMsgByChannel = new Map<string, '353' | '366'>()

  async setTargets(channels: string[]): Promise<void> {
    const next = new Set(channels.map(safeLower).filter(Boolean))
    // Part removed
    for (const ch of Array.from(this.desiredChannels.values())) {
      if (next.has(ch)) continue
      this.desiredChannels.delete(ch)
      this.part(ch)
    }

    // Join new
    for (const ch of Array.from(next.values())) {
      if (this.desiredChannels.has(ch)) continue
      this.desiredChannels.add(ch)
      this.join(ch)
    }

    if (this.desiredChannels.size === 0) {
      this.disconnect()
    } else {
      this.connect()
    }
  }

  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return

    this.intentionallyClosed = false
    const ws = new WebSocket(this.url, {
      headers: {
        Origin: 'https://www.twitch.tv',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
      },
      handshakeTimeout: 10000,
      perMessageDeflate: false,
    })
    this.ws = ws

    ws.on('open', () => {
      // Anonymous login
      this.sendRaw('CAP REQ :twitch.tv/tags twitch.tv/commands twitch.tv/membership')
      this.sendRaw('PASS SCHMOOPIIE')
      this.sendRaw(`NICK ${this.nick}`)

      // Join desired channels NOW that socket is open.
      for (const ch of Array.from(this.desiredChannels.values())) {
        const norm = safeLower(ch).replace(/^#/, '')
        if (!norm) continue
        if (this.joinedChannels.has(norm)) continue
        this.sendRaw(`JOIN #${norm}`)
        this.joinedChannels.add(norm)
      }
    })

    ws.on('message', (data: WebSocket.Data) => {
      const raw = data.toString()
      try {
        fileLogger.writeChatHistory('twitch', raw)
      } catch {
        // ignore
      }
      for (const line of splitLines(data)) {
        this.handleLine(line)
      }
    })

    ws.on('error', (err) => {
      fileLogger.writeLog('warn', 'main', '[Twitch] socket_error', [this.url, err?.message || String(err)])
      try {
        this.emit('error', err)
      } catch {
        // ignore
      }
    })

    ws.on('close', (code, reason) => {
      const text = reason?.toString?.() || ''
      this.ws = null
      this.joinedChannels.clear()
      this.chattersByChannel.clear()
      this.lastNamesMsgByChannel.clear()
      if (!this.intentionallyClosed && this.desiredChannels.size > 0) this.scheduleReconnect()
      this.emit('disconnected', { code, reason: text })
    })
  }

  disconnect(): void {
    this.intentionallyClosed = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (!this.ws) return
    try {
      this.ws.on('error', () => {})
    } catch {
      // ignore
    }
    try {
      this.ws.close()
    } catch {
      // ignore
    }
    this.ws = null
    this.joinedChannels.clear()
    this.chattersByChannel.clear()
    this.lastNamesMsgByChannel.clear()
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, 2000)
  }

  private sendRaw(line: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    try {
      this.ws.send(`${line}\r\n`)
    } catch {
      // ignore
    }
  }

  private join(channel: string): void {
    const ch = safeLower(channel).replace(/^#/, '')
    if (!ch) return
    if (this.joinedChannels.has(ch)) return
    this.connect()
    // Only mark as joined once we can actually send the JOIN line.
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return
    }
    this.sendRaw(`JOIN #${ch}`)
    this.joinedChannels.add(ch)
  }

  private part(channel: string): void {
    const ch = safeLower(channel).replace(/^#/, '')
    if (!ch) return
    if (!this.joinedChannels.has(ch)) return
    this.sendRaw(`PART #${ch}`)
    this.joinedChannels.delete(ch)
  }

  /**
   * Send a chat message to a channel. Current connection is anonymous (justinfan) so Twitch
   * will not accept PRIVMSG. Returns stub error until OAuth/login is implemented.
   */
  async sendMessage(channel: string, text: string): Promise<{ success: boolean; error?: string }> {
    const ch = safeLower(String(channel || '').trim()).replace(/^#/, '')
    const trimmed = String(text || '').trim()
    if (!ch) return { success: false, error: 'Missing channel' }
    if (!trimmed) return { success: false, error: 'Message is empty' }
    // Stub: sending requires authenticated IRC (OAuth). When auth is added, send PRIVMSG here.
    return { success: false, error: 'Twitch send requires login (not yet implemented)' }
  }

  private handleLine(line: string): void {
    if (!line) return

    if (line.startsWith('PING ')) {
      const payload = line.slice('PING '.length)
      this.sendRaw(`PONG ${payload}`)
      return
    }

    // Example:
    // @tags :prefix PRIVMSG #channel :message
    let rest = line
    let tags: Record<string, string> | null = null
    if (rest.startsWith('@')) {
      const space = rest.indexOf(' ')
      if (space > 0) {
        tags = parseIrcTags(rest.slice(1, space))
        rest = rest.slice(space + 1)
      }
    }

    // strip optional prefix (save for JOIN/PART)
    let ircPrefix = ''
    if (rest.startsWith(':')) {
      const space = rest.indexOf(' ')
      if (space > 0) {
        ircPrefix = rest.slice(1, space)
        rest = rest.slice(space + 1)
      }
    }

    const firstSpace = rest.indexOf(' ')
    const command = firstSpace > 0 ? rest.slice(0, firstSpace) : rest
    const afterCmd = firstSpace > 0 ? rest.slice(firstSpace + 1) : ''

    if (command === '353') {
      // NAMES: afterCmd = "nick = #channel :user1 user2 user3"
      const parts = afterCmd.split(' ')
      const eqIdx = parts.indexOf('=')
      if (eqIdx < 0 || eqIdx + 2 > parts.length) return
      const chan = safeLower(parts[eqIdx + 1]).replace(/^#/, '')
      const usersStart = afterCmd.indexOf(' :')
      const usersStr = usersStart >= 0 ? afterCmd.slice(usersStart + 2) : ''
      const users = usersStr.split(/\s+/).map(stripNickPrefix).filter(Boolean)

      if (this.lastNamesMsgByChannel.get(chan) === '366') {
        this.chattersByChannel.set(chan, new Set())
      }
      this.lastNamesMsgByChannel.set(chan, '353')
      let set = this.chattersByChannel.get(chan)
      if (!set) {
        set = new Set()
        this.chattersByChannel.set(chan, set)
      }
      users.forEach((u) => set!.add(u))
      return
    }

    if (command === '366') {
      // End of NAMES
      const parts = afterCmd.split(' ')
      if (parts.length < 2) return
      const chan = safeLower(parts[1]).replace(/^#/, '')
      this.lastNamesMsgByChannel.set(chan, '366')
      const set = this.chattersByChannel.get(chan)
      const names = Array.from(set ?? [])
      this.emit('names', { channel: chan, names })
      return
    }

    if (command === 'JOIN') {
      // JOIN #channel - nick from ircPrefix (:nick!nick@host)
      const nick = ircPrefix.split('!')[0]?.trim() || ''
      const chan = safeLower(afterCmd.trim()).replace(/^#/, '')
      if (chan && nick) {
        let set = this.chattersByChannel.get(chan)
        if (!set) {
          set = new Set()
          this.chattersByChannel.set(chan, set)
        }
        set.add(stripNickPrefix(nick))
        this.emit('names', { channel: chan, names: Array.from(set) })
      }
      return
    }

    if (command === 'PART') {
      const nick = ircPrefix.split('!')[0]?.trim() || ''
      const chan = safeLower(afterCmd.trim()).replace(/^#/, '')
      if (chan && nick) {
        const set = this.chattersByChannel.get(chan)
        if (set) {
          set.delete(stripNickPrefix(nick))
          this.emit('names', { channel: chan, names: Array.from(set) })
        }
      }
      return
    }

    if (command === 'PRIVMSG') {
      // afterCmd: "#channel :message"
      const chanEnd = afterCmd.indexOf(' ')
      if (chanEnd < 0) return
      const chan = safeLower(afterCmd.slice(0, chanEnd)).replace(/^#/, '')
      const msgPart = afterCmd.slice(chanEnd + 1)
      const colon = msgPart.indexOf(' :')
      const text = colon >= 0 ? msgPart.slice(colon + 2) : msgPart.startsWith(':') ? msgPart.slice(1) : msgPart

      const id = tags?.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`
      const displayName = tags?.['display-name'] || 'twitch'
      const color = tags?.color || undefined
      const userId = tags?.['user-id'] || undefined
      const tmiSentTs = tags?.['tmi-sent-ts'] ? Number(tags['tmi-sent-ts']) : undefined

      const msg: TwitchChatMessage = {
        platform: 'twitch',
        channel: chan,
        id,
        tmiSentTs: Number.isFinite(tmiSentTs as number) ? (tmiSentTs as number) : undefined,
        color,
        displayName,
        userId,
        text,
      }

      this.emit('message', msg)
      return
    }
  }
}

