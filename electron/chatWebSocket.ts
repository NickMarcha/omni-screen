import WebSocket from 'ws'
import { EventEmitter } from 'events'
import { fileLogger } from './fileLogger'

export interface ChatMessage {
  id: number
  nick: string
  roles: string[]
  features: string[]
  createdDate: string
  watching: {
    platform: string | null
    id: string | null
  } | null
  subscription: {
    tier: number
    source: string
  } | null
  timestamp: number
  data: string
  uuid?: string // Optional, present in PIN messages
}

/** Private message (whisper) from chat WebSocket: PRIVMSG { messageid, timestamp, nick, data }. */
export interface ChatPrivMsg {
  messageid: number
  timestamp: number
  nick: string
  data: string
}

export interface ChatPrivMsgEvent {
  type: 'PRIVMSG'
  privmsg: ChatPrivMsg
}

export interface ChatPinMessage extends ChatMessage {
  uuid: string
}

/** Unified history item (preserves order of MSG and BROADCAST in HISTORY array). */
export type ChatHistoryItem =
  | { type: 'MSG'; message: ChatMessage }
  | { type: 'BROADCAST'; broadcast: ChatBroadcastEvent['broadcast'] }

export interface ChatHistoryMessage {
  type: 'HISTORY'
  messages: ChatMessage[]
  /** When set, includes both MSG and BROADCAST in chronological order for correct render. */
  items?: ChatHistoryItem[]
}

export interface ChatUserEvent {
  type: 'JOIN' | 'QUIT' | 'UPDATEUSER'
  user: ChatMessage
}

export interface ChatPaidEvents {
  type: 'PAIDEVENTS'
  events: any[] // Array of paid events
}

export interface ChatPin {
  type: 'PIN'
  pin: ChatPinMessage
}

export interface ChatNames {
  type: 'NAMES'
  names: any // Structure unknown, will be logged
}

export interface ChatMute {
  type: 'MUTE'
  mute: any // Structure unknown, will be logged
}

/** UNMUTE indicates a user was unmuted (semantically an unban). Payload is same shape as ChatMessage. */
export interface ChatUnmute {
  type: 'UNMUTE'
  unmute: ChatMessage
}

export interface ChatMe {
  type: 'ME'
  data: any // Structure unknown, will be logged
}

export interface ChatPollStart {
  type: 'POLLSTART'
  poll: {
    canvote: boolean
    myvote: number
    nick: string
    weighted: boolean
    start: string
    now: string
    time: number
    question: string
    options: string[]
    totals: number[]
    totalvotes: number
  }
}

export interface ChatVoteCast {
  type: 'VOTECAST'
  vote: {
    vote: string
    quantity: number
  }
}

export interface ChatPollStop {
  type: 'POLLSTOP'
  poll: {
    canvote: boolean
    myvote: number
    nick: string
    weighted: boolean
    start: string
    now: string
    time: number
    question: string
    options: string[]
    totals: number[]
    totalvotes: number
  }
}

// Additional server event message types (not standard chat messages)
export interface ChatDeathMessage extends ChatMessage {
  duration: number
}

export interface ChatDeathEvent {
  type: 'DEATH'
  death: ChatDeathMessage
}

export interface ChatUnbanEvent {
  type: 'UNBAN'
  unban: ChatMessage
}

export interface ChatSubscriptionEvent {
  type: 'SUBSCRIPTION'
  subscription: {
    timestamp: number
    nick: string
    data: string
    user: ChatMessage
    uuid: string
    amount: number
    expirationTimestamp: number
    tier: number
    tierLabel: string
    streak: number
  }
}

export interface ChatBroadcastEvent {
  type: 'BROADCAST'
  broadcast: {
    timestamp: number
    nick: string
    data: string
    user: {
      id: number
      nick: string
      roles: string[]
      features: string[]
      createdDate: string | null
    }
    uuid: string
  }
}

/** BAN: data.data = banned nick, data.nick = who banned, data.timestamp */
export interface ChatBanEvent {
  type: 'BAN'
  ban: { data: string; nick?: string; timestamp?: number }
}

/** SUBONLY: data.data === 'on' when enabled */
export interface ChatSubOnlyEvent {
  type: 'SUBONLY'
  subonly: { data: string; nick?: string; timestamp?: number }
}

/** RELOAD: no payload; server asks client to reload (emotes/flairs) */
export interface ChatReloadEvent {
  type: 'RELOAD'
}

/** PRIVMSGSENT: confirmation that our whisper was sent; no payload */
export interface ChatPrivMsgSentEvent {
  type: 'PRIVMSGSENT'
}

/** ADDPHRASE / REMOVEPHRASE: data.data = the phrase */
export interface ChatPhraseEvent {
  type: 'ADDPHRASE' | 'REMOVEPHRASE'
  phrase: { data: string; timestamp?: number }
}

/** GIFTSUB: gift sub event (user, recipient, tier, etc.) */
export interface ChatGiftSubEvent {
  type: 'GIFTSUB'
  giftSub: {
    data?: string
    user?: { nick: string; id?: number; [k: string]: unknown }
    recipient?: { nick: string; [k: string]: unknown }
    tier?: number
    tierLabel?: string
    amount?: number
    fromMassGift?: boolean
    timestamp?: number
    expirationTimestamp?: number
    uuid?: string
    [k: string]: unknown
  }
}

/** MASSGIFT: mass gift subs */
export interface ChatMassGiftEvent {
  type: 'MASSGIFT'
  massGift: {
    data?: string
    user?: { nick: string; [k: string]: unknown }
    tier?: number
    tierLabel?: string
    amount?: number
    quantity?: number
    timestamp?: number
    expirationTimestamp?: number
    uuid?: string
    [k: string]: unknown
  }
}

/** DONATION */
export interface ChatDonationEvent {
  type: 'DONATION'
  donation: {
    data?: string
    user?: { nick: string; [k: string]: unknown }
    amount?: number
    timestamp?: number
    expirationTimestamp?: number
    uuid?: string
    [k: string]: unknown
  }
}

export type ChatWebSocketEvent =
  | ChatHistoryMessage
  | ChatUserEvent
  | ChatPaidEvents
  | ChatPin
  | ChatNames
  | ChatMute
  | ChatUnmute
  | ChatMe
  | ChatPollStart
  | ChatVoteCast
  | ChatPollStop
  | ChatDeathEvent
  | ChatUnbanEvent
  | ChatSubscriptionEvent
  | ChatBroadcastEvent
  | { type: 'MSG'; message: ChatMessage }

/** Default origin when not provided (e.g. from env config). Redacted; actual origin comes from chat source extension. */
const DEFAULT_ORIGIN = 'https://redacted'

/** Optional collect for HISTORY: handlers for MSG/BROADCAST push into these arrays when provided. */
export type ChatMessageHandler = (
  ws: ChatWebSocket,
  message: string,
  collect?: { messages: ChatMessage[]; items: ChatHistoryItem[] }
) => void

/** Map of chat message type token (first word) to handler. Single source of truth: if type is in map we run it, else we log discrepancy. */
function createChatHandlers(): Record<string, ChatMessageHandler> {
  const h: Record<string, ChatMessageHandler> = {}

  h.MSG = (ws, message, collect) => {
    try {
      const msgData = JSON.parse(message.substring(4)) as ChatMessage
      ws.emit('message', { type: 'MSG', message: msgData })
      if (collect) {
        collect.messages.push(msgData)
        collect.items.push({ type: 'MSG', message: msgData })
      }
    } catch (e) {
      console.error('[ChatWebSocket] Failed to parse MSG:', e, 'Message:', message.substring(0, 100))
      fileLogger.writeWsDiscrepancy('chat', 'msg_parse_error', { preview: message.substring(0, 2000), error: e instanceof Error ? e.message : String(e) })
    }
  }

  h.PRIVMSG = (ws, message) => {
    try {
      const privmsgData = JSON.parse(message.substring(8)) as ChatPrivMsg
      ws.emit('privmsg', { type: 'PRIVMSG', privmsg: privmsgData } as ChatPrivMsgEvent)
    } catch (e) {
      console.error('[ChatWebSocket] Failed to parse PRIVMSG:', e, 'Message:', message.substring(0, 100))
      fileLogger.writeWsDiscrepancy('chat', 'privmsg_parse_error', { preview: message.substring(0, 500), error: e instanceof Error ? e.message : String(e) })
    }
  }

  h.JOIN = (ws, message) => {
    try {
      const userData = JSON.parse(message.substring(5)) as ChatMessage
      ws.emit('userEvent', { type: 'JOIN', user: userData } as ChatUserEvent)
    } catch (e) {
      console.error('[ChatWebSocket] Failed to parse JOIN:', e, 'Message:', message.substring(0, 100))
      fileLogger.writeWsDiscrepancy('chat', 'join_parse_error', { preview: message.substring(0, 2000), error: e instanceof Error ? e.message : String(e) })
    }
  }

  h.QUIT = (ws, message) => {
    try {
      const userData = JSON.parse(message.substring(5)) as ChatMessage
      ws.emit('userEvent', { type: 'QUIT', user: userData } as ChatUserEvent)
    } catch (e) {
      console.error('[ChatWebSocket] Failed to parse QUIT:', e, 'Message:', message.substring(0, 100))
      fileLogger.writeWsDiscrepancy('chat', 'quit_parse_error', { preview: message.substring(0, 2000), error: e instanceof Error ? e.message : String(e) })
    }
  }

  h.UPDATEUSER = (ws, message) => {
    try {
      const jsonPart = message.substring(11).trim()
      if (!jsonPart || jsonPart.length === 0) {
        console.error('[ChatWebSocket] UPDATEUSER has empty JSON part. Full message length:', message.length)
        return
      }
      const userData = JSON.parse(jsonPart) as ChatMessage
      ws.emit('userEvent', { type: 'UPDATEUSER', user: userData } as ChatUserEvent)
    } catch (e) {
      console.error('[ChatWebSocket] Failed to parse UPDATEUSER:', e)
      fileLogger.writeWsDiscrepancy('chat', 'updateuser_parse_error', { preview: message.substring(0, 2000), error: e instanceof Error ? e.message : String(e) })
    }
  }

  h.PAIDEVENTS = (ws, message) => {
    try {
      let eventsData: any[] = []
      const jsonPart = message.startsWith('PAIDEVENTS ') ? message.substring(11).trim() : message.substring(10).trim()
      if (jsonPart && jsonPart.length > 0) eventsData = JSON.parse(jsonPart) as any[]
      ws.emit('paidEvents', { type: 'PAIDEVENTS', events: eventsData } as ChatPaidEvents)
    } catch (e) {
      console.error('[ChatWebSocket] Failed to parse PAIDEVENTS:', e)
    }
  }

  h.PIN = (ws, message) => {
    try {
      const pinData = JSON.parse(message.substring(4)) as ChatPinMessage
      ws.emit('pin', { type: 'PIN', pin: pinData } as ChatPin)
    } catch (e) {
      console.error('[ChatWebSocket] Failed to parse PIN:', e, 'Message:', message.substring(0, 100))
    }
  }

  h.NAMES = (ws, message) => {
    try {
      const namesData = JSON.parse(message.substring(6))
      ws.emit('names', { type: 'NAMES', names: namesData } as ChatNames)
    } catch (e) {
      console.error('[ChatWebSocket] Failed to parse NAMES:', e, 'Message:', message.substring(0, 100))
    }
  }

  h.MUTE = (ws, message) => {
    try {
      const muteData = JSON.parse(message.substring(5))
      ws.emit('mute', { type: 'MUTE', mute: muteData } as ChatMute)
    } catch (e) {
      console.error('[ChatWebSocket] Failed to parse MUTE:', e, 'Message:', message.substring(0, 100))
    }
  }

  h.UNMUTE = (ws, message) => {
    try {
      const unmuteData = JSON.parse(message.substring(7)) as ChatMessage
      ws.emit('unmute', { type: 'UNMUTE', unmute: unmuteData } as ChatUnmute)
    } catch (e) {
      console.error('[ChatWebSocket] Failed to parse UNMUTE:', e, 'Message:', message.substring(0, 100))
      fileLogger.writeWsDiscrepancy('chat', 'unmute_parse_error', { preview: message.substring(0, 2000), error: e instanceof Error ? e.message : String(e) })
    }
  }

  h.ME = (ws, message) => {
    try {
      const meData = message.substring(3).trim()
      const parsedData = meData === 'null' ? null : JSON.parse(meData)
      ws.emit('me', { type: 'ME', data: parsedData } as ChatMe)
    } catch (e) {
      console.error('[ChatWebSocket] Failed to parse ME:', e, 'Message:', message.substring(0, 100))
    }
  }

  h.POLLSTART = (ws, message) => {
    try {
      const pollData = JSON.parse(message.substring(10))
      ws.emit('pollStart', { type: 'POLLSTART', poll: pollData } as ChatPollStart)
    } catch (e) {
      console.error('[ChatWebSocket] Failed to parse POLLSTART:', e, 'Message:', message.substring(0, 100))
    }
  }

  h.VOTECAST = (ws, message) => {
    try {
      const voteData = JSON.parse(message.substring(9))
      ws.emit('voteCast', { type: 'VOTECAST', vote: voteData } as ChatVoteCast)
    } catch (e) {
      console.error('[ChatWebSocket] Failed to parse VOTECAST:', e, 'Message:', message.substring(0, 100))
    }
  }

  h.POLLSTOP = (ws, message) => {
    try {
      const pollData = JSON.parse(message.substring(9))
      ws.emit('pollStop', { type: 'POLLSTOP', poll: pollData } as ChatPollStop)
    } catch (e) {
      console.error('[ChatWebSocket] Failed to parse POLLSTOP:', e, 'Message:', message.substring(0, 100))
    }
  }

  h.VOTECOUNTED = (ws, message) => {
    try {
      const data = JSON.parse(message.substring(12)) as { vote?: string }
      ws.emit('voteCounted', { vote: data?.vote ?? '' })
    } catch (e) {
      console.error('[ChatWebSocket] Failed to parse VOTECOUNTED:', e, 'Message:', message.substring(0, 100))
    }
  }

  h.ERR = (ws, message) => {
    try {
      const data = JSON.parse(message.substring(4)) as { description?: string }
      if (data?.description === 'alreadyvoted' || data?.description) ws.emit('pollVoteError', { description: data.description })
      if (data?.description) ws.emit('chatErr', { description: data.description })
    } catch (e) {
      console.error('[ChatWebSocket] Failed to parse ERR:', e, 'Message:', message.substring(0, 100))
    }
  }

  h.DEATH = (ws, message) => {
    try {
      const deathData = JSON.parse(message.substring(6)) as ChatDeathMessage
      ws.emit('death', { type: 'DEATH', death: deathData } as ChatDeathEvent)
    } catch (e) {
      console.error('[ChatWebSocket] Failed to parse DEATH:', e, 'Message:', message.substring(0, 120))
      fileLogger.writeWsDiscrepancy('chat', 'death_parse_error', { preview: message.substring(0, 2000), error: e instanceof Error ? e.message : String(e) })
    }
  }

  h.UNBAN = (ws, message) => {
    try {
      const unbanData = JSON.parse(message.substring(6)) as ChatMessage
      ws.emit('unban', { type: 'UNBAN', unban: unbanData } as ChatUnbanEvent)
    } catch (e) {
      console.error('[ChatWebSocket] Failed to parse UNBAN:', e, 'Message:', message.substring(0, 120))
      fileLogger.writeWsDiscrepancy('chat', 'unban_parse_error', { preview: message.substring(0, 2000), error: e instanceof Error ? e.message : String(e) })
    }
  }

  h.SUBSCRIPTION = (ws, message) => {
    try {
      const subData = JSON.parse(message.substring(13)) as ChatSubscriptionEvent['subscription']
      ws.emit('subscription', { type: 'SUBSCRIPTION', subscription: subData } as ChatSubscriptionEvent)
    } catch (e) {
      console.error('[ChatWebSocket] Failed to parse SUBSCRIPTION:', e, 'Message:', message.substring(0, 120))
      fileLogger.writeWsDiscrepancy('chat', 'subscription_parse_error', { preview: message.substring(0, 2000), error: e instanceof Error ? e.message : String(e) })
    }
  }

  h.BROADCAST = (ws, message, collect) => {
    try {
      const broadcastData = JSON.parse(message.substring(10)) as ChatBroadcastEvent['broadcast']
      if (collect) collect.items.push({ type: 'BROADCAST', broadcast: broadcastData })
      ws.emit('broadcast', { type: 'BROADCAST', broadcast: broadcastData } as ChatBroadcastEvent)
    } catch (e) {
      console.error('[ChatWebSocket] Failed to parse BROADCAST:', e, 'Message:', message.substring(0, 120))
      fileLogger.writeWsDiscrepancy('chat', 'broadcast_parse_error', { preview: message.substring(0, 2000), error: e instanceof Error ? e.message : String(e) })
    }
  }

  h.BAN = (ws, message) => {
    try {
      const data = JSON.parse(message.substring(4)) as { data?: string; nick?: string; timestamp?: number }
      ws.emit('ban', { type: 'BAN', ban: data } as ChatBanEvent)
    } catch (e) {
      console.error('[ChatWebSocket] Failed to parse BAN:', e, 'Message:', message.substring(0, 100))
    }
  }

  h.SUBONLY = (ws, message) => {
    try {
      const data = JSON.parse(message.substring(8)) as { data?: string; nick?: string; timestamp?: number }
      ws.emit('subonly', { type: 'SUBONLY', subonly: data } as ChatSubOnlyEvent)
    } catch (e) {
      console.error('[ChatWebSocket] Failed to parse SUBONLY:', e, 'Message:', message.substring(0, 100))
    }
  }

  h.RELOAD = (ws) => {
    ws.emit('reload', { type: 'RELOAD' } as ChatReloadEvent)
  }

  h.PRIVMSGSENT = (ws) => {
    ws.emit('privmsgsent', { type: 'PRIVMSGSENT' } as ChatPrivMsgSentEvent)
  }

  h.ADDPHRASE = (ws, message) => {
    try {
      const data = JSON.parse(message.substring(10)) as { data?: string; timestamp?: number }
      ws.emit('addphrase', { type: 'ADDPHRASE', phrase: data } as ChatPhraseEvent)
    } catch (e) {
      console.error('[ChatWebSocket] Failed to parse ADDPHRASE:', e, 'Message:', message.substring(0, 100))
    }
  }

  h.REMOVEPHRASE = (ws, message) => {
    try {
      const data = JSON.parse(message.substring(12)) as { data?: string; timestamp?: number }
      ws.emit('removephrase', { type: 'REMOVEPHRASE', phrase: data } as ChatPhraseEvent)
    } catch (e) {
      console.error('[ChatWebSocket] Failed to parse REMOVEPHRASE:', e, 'Message:', message.substring(0, 100))
    }
  }

  h.GIFTSUB = (ws, message) => {
    try {
      const data = JSON.parse(message.substring(8)) as ChatGiftSubEvent['giftSub']
      ws.emit('giftsub', { type: 'GIFTSUB', giftSub: data } as ChatGiftSubEvent)
    } catch (e) {
      console.error('[ChatWebSocket] Failed to parse GIFTSUB:', e, 'Message:', message.substring(0, 120))
    }
  }

  h.MASSGIFT = (ws, message) => {
    try {
      const data = JSON.parse(message.substring(9)) as ChatMassGiftEvent['massGift']
      ws.emit('massgift', { type: 'MASSGIFT', massGift: data } as ChatMassGiftEvent)
    } catch (e) {
      console.error('[ChatWebSocket] Failed to parse MASSGIFT:', e, 'Message:', message.substring(0, 120))
    }
  }

  h.DONATION = (ws, message) => {
    try {
      const data = JSON.parse(message.substring(9)) as ChatDonationEvent['donation']
      ws.emit('donation', { type: 'DONATION', donation: data } as ChatDonationEvent)
    } catch (e) {
      console.error('[ChatWebSocket] Failed to parse DONATION:', e, 'Message:', message.substring(0, 120))
    }
  }

  // HISTORY must be last: it dispatches to other handlers with collect for MSG/BROADCAST
  h.HISTORY = (ws, message) => {
    console.log('[ChatWebSocket] Received HISTORY message, length:', message.length)
    const historyMatch = message.match(/^HISTORY\s+(.+)$/)
    if (!historyMatch) return
    try {
      const messagesArray = JSON.parse(historyMatch[1]) as string[]
      console.log(`[ChatWebSocket] Parsed HISTORY array with ${messagesArray.length} items`)
      const parsedMessages: ChatMessage[] = []
      const parsedItems: ChatHistoryItem[] = []
      const collect = { messages: parsedMessages, items: parsedItems }

      for (const msgStr of messagesArray) {
        try {
          const typeToken = msgStr.split(' ', 1)[0]
          const handler = h[typeToken]
          if (handler) {
            handler(ws, msgStr, collect)
          } else {
            console.log('[ChatWebSocket] Unsupported message type in HISTORY:', msgStr.substring(0, 50))
            fileLogger.writeWsDiscrepancy('chat', 'unsupported_history_item', { preview: msgStr.substring(0, 400) })
          }
        } catch (e) {
          console.error('[ChatWebSocket] Unexpected error processing HISTORY item:', e, 'Message:', msgStr?.substring(0, 100) || 'unknown')
        }
      }

      if (parsedMessages.length > 0 || parsedItems.length > 0) {
        console.log(`[ChatWebSocket] Emitting history event with ${parsedMessages.length} messages, ${parsedItems.length} items`)
        ws.emit('history', {
          type: 'HISTORY',
          messages: parsedMessages,
          items: parsedItems.length > 0 ? parsedItems : undefined,
        } as ChatHistoryMessage)
      } else {
        console.log('[ChatWebSocket] No messages parsed from HISTORY, skipping history event')
      }
    } catch (e) {
      console.error('[ChatWebSocket] Failed to parse HISTORY:', e, 'Raw message:', message.substring(0, 200))
      fileLogger.writeWsDiscrepancy('chat', 'history_parse_error', { preview: message.substring(0, 2000), error: e instanceof Error ? e.message : String(e) })
    }
  }

  return h
}

const CHAT_HANDLERS = createChatHandlers()

export interface ChatWebSocketConnectOptions {
  /** Request headers (Cookie, Origin) for authenticated connection. Uses persist:main session. */
  headers?: Record<string, string>
}

export class ChatWebSocket extends EventEmitter {
  private ws: WebSocket | null = null
  private url: string
  private reconnectAttempts = 0
  private maxReconnectAttempts = 10
  private reconnectDelay = 1000 // Start with 1 second
  private maxReconnectDelay = 30000 // Max 30 seconds
  private reconnectTimer: NodeJS.Timeout | null = null
  private isIntentionallyClosed = false
  private heartbeatInterval: NodeJS.Timeout | null = null
  private connectionTimeout: NodeJS.Timeout | null = null
  private typeCounts: Map<string, number> = new Map()
  private seenTypes: Set<string> = new Set()
  /** Stored headers (Cookie, Origin) for reconnects so session is preserved. */
  private connectionHeaders: Record<string, string> | null = null

  constructor(
    url: string = 'wss://redacted/ws',
    private readonly origin: string = DEFAULT_ORIGIN
  ) {
    super()
    this.url = url
  }

  /**
   * Connect to the WebSocket server.
   * Pass headers (e.g. Cookie, Origin) from the Electron session for authenticated connection.
   */
  connect(options?: ChatWebSocketConnectOptions): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      console.log('[ChatWebSocket] Already connected or connecting')
      return
    }

    if (options?.headers) {
      this.connectionHeaders = { ...options.headers }
    }

    this.isIntentionallyClosed = false
    console.log(`[ChatWebSocket] Connecting to ${this.url}...`)

    const headers: Record<string, string> = {
      ...(this.connectionHeaders ?? {}),
      Origin: this.connectionHeaders?.Origin ?? this.connectionHeaders?.origin ?? this.origin,
    }

    try {
      this.ws = new WebSocket(this.url, [], { headers, origin: this.origin })

      // Set connection timeout
      this.connectionTimeout = setTimeout(() => {
        if (this.ws && this.ws.readyState !== WebSocket.OPEN) {
          console.error('[ChatWebSocket] Connection timeout')
          this.ws.close()
          this.handleReconnect()
        }
      }, 10000) // 10 second timeout

      this.ws.on('open', () => {
        console.log('[ChatWebSocket] Connected')
        this.connectionTimeout && clearTimeout(this.connectionTimeout)
        this.connectionTimeout = null
        this.reconnectAttempts = 0
        this.reconnectDelay = 1000
        this.emit('connected')
        this.startHeartbeat()
      })

      this.ws.on('message', (data: WebSocket.Data) => {
        this.handleMessage(data)
      })

      this.ws.on('error', (error: Error) => {
        const errorMessage = error?.message || String(error) || 'Unknown error'
        console.error('[ChatWebSocket] Error:', errorMessage)
        fileLogger.writeLog('warn', 'main', '[ChatWebSocket] socket_error', [this.url, errorMessage])
        this.connectionTimeout && clearTimeout(this.connectionTimeout)
        this.connectionTimeout = null
        // Emit error but don't throw - let reconnection handle it
        try {
          this.emit('error', error)
        } catch (emitError) {
          console.error('[ChatWebSocket] Failed to emit error event:', emitError)
        }
      })

      this.ws.on('close', (code: number, reason: Buffer) => {
        console.log(`[ChatWebSocket] Closed: code=${code}, reason=${reason.toString()}`)
        this.connectionTimeout && clearTimeout(this.connectionTimeout)
        this.connectionTimeout = null
        this.stopHeartbeat()
        this.emit('disconnected', { code, reason: reason.toString() })

        // Reconnect if not intentionally closed
        if (!this.isIntentionallyClosed) {
          this.handleReconnect()
        }
      })

      this.ws.on('ping', () => {
        // Respond to ping with pong
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.pong()
        }
      })
    } catch (error) {
      console.error('[ChatWebSocket] Failed to create connection:', error)
      fileLogger.writeLog('error', 'main', '[ChatWebSocket] connect_exception', [this.url, error instanceof Error ? error.message : String(error)])
      this.emit('error', error)
      this.handleReconnect()
    }
  }

  /**
   * Disconnect from the WebSocket server
   */
  disconnect(): void {
    this.isIntentionallyClosed = true
    this.stopHeartbeat()
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout)
      this.connectionTimeout = null
    }

    if (this.ws) {
      const readyState = this.ws.readyState
      
      // IMPORTANT:
      // If we remove all listeners and then terminate/close, the ws library can emit an 'error'
      // event (e.g. "WebSocket was closed before the connection was established"). With no
      // listeners attached, Node treats it as unhandled and can crash the app.
      // Remove the existing error handler first so we don't log/emit during shutdown, then
      // attach a no-op so the library doesn't see an unhandled error.
      this.ws.removeAllListeners('error')
      this.ws.on('error', () => {
        // Swallow errors during intentional shutdown
      })

      // Remove other event listeners to prevent callbacks during close
      this.ws.removeAllListeners('open')
      this.ws.removeAllListeners('message')
      this.ws.removeAllListeners('close')
      this.ws.removeAllListeners('ping')
      
      // Only attempt to close if WebSocket is OPEN or CONNECTING
      // If it's already CLOSED or CLOSING, just clean up
      if (readyState === WebSocket.OPEN || readyState === WebSocket.CONNECTING) {
        try {
          // For CONNECTING state, terminate immediately without waiting
          if (readyState === WebSocket.CONNECTING) {
            this.ws.terminate()
          } else {
            this.ws.close()
          }
        } catch (error) {
          // Ignore errors when closing - the WebSocket might already be closing/closed
          // This can happen in React StrictMode when component unmounts during connection
          console.log('[ChatWebSocket] Error during close (ignored):', error instanceof Error ? error.message : String(error))
        }
      }
      
      this.ws = null
    }

    console.log('[ChatWebSocket] Disconnected')
    this.emit('disconnected', { code: 1000, reason: 'Intentional disconnect' })
  }

  /**
   * Check if the WebSocket is connected
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }

  /**
   * Send a message to the WebSocket server
   */
  send(data: string): boolean {
    if (!this.isConnected()) {
      console.warn('[ChatWebSocket] Cannot send message: not connected')
      return false
    }

    try {
      this.ws!.send(data)
      return true
    } catch (error) {
      console.error('[ChatWebSocket] Failed to send message:', error)
      this.emit('error', error)
      return false
    }
  }

  /**
   * Handle incoming messages
   * All parsing errors are caught and logged, but never crash the application
   */
  private handleMessage(data: WebSocket.Data): void {
    let message: string
    try {
      message = data.toString()
    } catch (error) {
      console.error('[ChatWebSocket] Failed to convert message data to string:', error)
      return // Exit early if we can't even convert to string
    }

    // Track raw message types by first token (e.g. MSG, HISTORY, JOIN, ...)
    const typeToken = message.split(' ', 1)[0] || 'UNKNOWN'
    const nextCount = (this.typeCounts.get(typeToken) || 0) + 1
    this.typeCounts.set(typeToken, nextCount)

    const handler = CHAT_HANDLERS[typeToken]
    if (handler) {
      try {
        handler(this, message)
        return
      } catch (error) {
        console.error('[ChatWebSocket] Unexpected error handling message:', error)
        fileLogger.writeWsDiscrepancy('chat', 'handler_exception', {
          preview: message?.substring(0, 2000) || 'unknown',
          error: error instanceof Error ? error.message : String(error),
        })
        return
      }
    }

    // Type not in CHAT_HANDLERS: log first occurrence and run fallback (unsupported message)
    if (!this.seenTypes.has(typeToken)) {
      this.seenTypes.add(typeToken)
      fileLogger.writeWsDiscrepancy('chat', 'new_type_observed', {
        type: typeToken,
        length: message.length,
        preview: typeToken === 'HISTORY' ? undefined : message.substring(0, 400),
      })
    }
    this.handleMessageFallback(message)
  }

  /** Only used when message type has no handler in CHAT_HANDLERS (unknown type). */
  private handleMessageFallback(message: string): void {
    try {
      console.log('[ChatWebSocket] Unsupported message type:', message.substring(0, 100))
      console.log('[ChatWebSocket] Full unsupported message:', message)
      fileLogger.writeWsDiscrepancy('chat', 'unsupported_message', {
        preview: message.substring(0, 2000),
        length: message.length,
      })
    } catch (error) {
      console.error('[ChatWebSocket] Unexpected error handling message:', error)
      console.error('[ChatWebSocket] Message that caused error:', message?.substring(0, 200) || 'unknown')
      fileLogger.writeWsDiscrepancy('chat', 'handler_exception', {
        preview: message?.substring(0, 2000) || 'unknown',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * Handle reconnection logic with exponential backoff
   */
  private handleReconnect(): void {
    if (this.isIntentionallyClosed) {
      return
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[ChatWebSocket] Max reconnection attempts reached')
      fileLogger.writeLog('warn', 'main', '[ChatWebSocket] max_reconnect_attempts_reached', [this.url, this.maxReconnectAttempts])
      this.emit('maxReconnectAttemptsReached')
      return
    }

    this.reconnectAttempts++
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), this.maxReconnectDelay)
    
    console.log(`[ChatWebSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`)

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  /**
   * Start heartbeat to keep connection alive
   */
  private startHeartbeat(): void {
    this.stopHeartbeat()
    
    // Send ping every 30 seconds
    this.heartbeatInterval = setInterval(() => {
      if (this.isConnected()) {
        try {
          this.ws!.ping()
        } catch (error) {
          console.error('[ChatWebSocket] Heartbeat ping failed:', error)
        }
      }
    }, 30000)
  }

  /**
   * Stop heartbeat
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.disconnect()
    this.removeAllListeners()
  }
}
