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

export interface ChatHistoryMessage {
  type: 'HISTORY'
  messages: ChatMessage[]
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

const DESTINY_ORIGIN = 'https://www.destiny.gg'

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

  constructor(url: string = 'wss://chat.destiny.gg/ws') {
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
      Origin: this.connectionHeaders?.Origin ?? this.connectionHeaders?.origin ?? DESTINY_ORIGIN,
    }

    try {
      this.ws = new WebSocket(this.url, [], { headers, origin: DESTINY_ORIGIN })

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
      // Keep a no-op error handler during intentional shutdown.
      try {
        this.ws.on('error', () => {
          // Swallow errors during intentional shutdown
        })
      } catch {
        // ignore
      }
      
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

    // Track raw message types by first token (e.g. MSG, HISTORY, JOIN, DEATH, SUBSCRIPTION, ...)
    const typeToken = message.split(' ', 1)[0] || 'UNKNOWN'
    const nextCount = (this.typeCounts.get(typeToken) || 0) + 1
    this.typeCounts.set(typeToken, nextCount)
    const knownChatTypes = new Set(['MSG', 'HISTORY', 'JOIN', 'QUIT', 'NAMES', 'PIN', 'PAIDEVENTS', 'ME', 'UPDATEUSER', 'POLLSTART', 'POLLSTOP', 'VOTECOUNTED', 'POLLVOTEERROR', 'ERR', 'PRIVMSG', 'DEATH', 'UNBAN', 'SUBSCRIPTION', 'BROADCAST', 'BAN', 'SUBONLY', 'RELOAD', 'PRIVMSGSENT', 'ADDPHRASE', 'REMOVEPHRASE', 'GIFTSUB', 'MASSGIFT', 'DONATION'])
    if (!this.seenTypes.has(typeToken)) {
      this.seenTypes.add(typeToken)
      if (!knownChatTypes.has(typeToken)) {
        if (typeToken === 'HISTORY') {
          fileLogger.writeWsDiscrepancy('chat', 'new_type_observed', {
            type: typeToken,
            length: message.length,
          })
        } else {
          fileLogger.writeWsDiscrepancy('chat', 'new_type_observed', {
            type: typeToken,
            length: message.length,
            preview: message.substring(0, 400),
          })
        }
      }
    }
    
    try {
      // Parse the message type
      if (message.startsWith('HISTORY')) {
        console.log('[ChatWebSocket] Received HISTORY message, length:', message.length)
        // HISTORY ["MSG {...}", "MSG {...}", "PAIDEVENTS []", "PIN {...}", "NAMES {...}", ...]
        const historyMatch = message.match(/^HISTORY\s+(.+)$/)
        if (historyMatch) {
          console.log('[ChatWebSocket] HISTORY match found, parsing JSON array...')
          try {
            const messagesArray = JSON.parse(historyMatch[1]) as string[]
            console.log(`[ChatWebSocket] Parsed HISTORY array with ${messagesArray.length} items`)
            const parsedMessages: ChatMessage[] = []
            
            messagesArray.forEach(msgStr => {
              try {
                if (msgStr.startsWith('MSG ')) {
                  try {
                    const msgData = JSON.parse(msgStr.substring(4)) as ChatMessage
                    parsedMessages.push(msgData)
                  } catch (e) {
                    console.error('[ChatWebSocket] Failed to parse MSG in HISTORY:', e, 'Message:', msgStr.substring(0, 100))
                  }
                } else if (msgStr.startsWith('PRIVMSG ')) {
                  try {
                    const privmsgData = JSON.parse(msgStr.substring(8)) as ChatPrivMsg
                    this.emit('privmsg', { type: 'PRIVMSG', privmsg: privmsgData } as ChatPrivMsgEvent)
                  } catch (e) {
                    console.error('[ChatWebSocket] Failed to parse PRIVMSG in HISTORY:', e, 'Message:', msgStr.substring(0, 100))
                  }
                } else if (msgStr.startsWith('PAIDEVENTS')) {
                try {
                  // PAIDEVENTS can be "PAIDEVENTS []" or "PAIDEVENTS[]"
                  let eventsData: any[] = []
                  let jsonPart: string
                  if (msgStr.startsWith('PAIDEVENTS ')) {
                    // "PAIDEVENTS []" - extract everything after the space
                    jsonPart = msgStr.substring(11).trim()
                  } else {
                    // "PAIDEVENTS[]" - extract everything after "PAIDEVENTS"
                    jsonPart = msgStr.substring(10).trim()
                  }
                  
                  if (jsonPart && jsonPart.length > 0) {
                    eventsData = JSON.parse(jsonPart) as any[]
                  }
                  
                  this.emit('paidEvents', { type: 'PAIDEVENTS', events: eventsData } as ChatPaidEvents)
                } catch (e) {
                  console.error('[ChatWebSocket] Failed to parse PAIDEVENTS in HISTORY:', e)
                  console.error('[ChatWebSocket] Full message:', msgStr)
                  console.error('[ChatWebSocket] Extracted JSON part:', msgStr.startsWith('PAIDEVENTS ') ? msgStr.substring(11) : msgStr.substring(10))
                }
                } else if (msgStr.startsWith('PIN ')) {
                  try {
                    const pinData = JSON.parse(msgStr.substring(4)) as ChatPinMessage
                    this.emit('pin', { type: 'PIN', pin: pinData } as ChatPin)
                  } catch (e) {
                    console.error('[ChatWebSocket] Failed to parse PIN in HISTORY:', e, 'Message:', msgStr.substring(0, 100))
                  }
                } else if (msgStr.startsWith('NAMES ')) {
                  try {
                    const namesData = JSON.parse(msgStr.substring(6))
                    this.emit('names', { type: 'NAMES', names: namesData } as ChatNames)
                  } catch (e) {
                    console.error('[ChatWebSocket] Failed to parse NAMES in HISTORY:', e, 'Message:', msgStr.substring(0, 100))
                  }
                } else if (msgStr.startsWith('MUTE ')) {
                  try {
                    const muteData = JSON.parse(msgStr.substring(5))
                    this.emit('mute', { type: 'MUTE', mute: muteData } as ChatMute)
                  } catch (e) {
                    console.error('[ChatWebSocket] Failed to parse MUTE in HISTORY:', e, 'Message:', msgStr.substring(0, 100))
                  }
                } else if (msgStr.startsWith('UNMUTE ')) {
                  try {
                    const unmuteData = JSON.parse(msgStr.substring(7)) as ChatMessage
                    this.emit('unmute', { type: 'UNMUTE', unmute: unmuteData } as ChatUnmute)
                  } catch (e) {
                    console.error('[ChatWebSocket] Failed to parse UNMUTE in HISTORY:', e, 'Message:', msgStr.substring(0, 100))
                  }
                } else if (msgStr.startsWith('ME ')) {
                  try {
                    const meData = msgStr.substring(3).trim()
                    // ME can be "ME null" or "ME {...}"
                    const parsedData = meData === 'null' ? null : JSON.parse(meData)
                    this.emit('me', { type: 'ME', data: parsedData } as ChatMe)
                  } catch (e) {
                    console.error('[ChatWebSocket] Failed to parse ME in HISTORY:', e, 'Message:', msgStr.substring(0, 100))
                  }
                } else if (msgStr.startsWith('POLLSTART ')) {
                  try {
                    const pollData = JSON.parse(msgStr.substring(10))
                    this.emit('pollStart', { type: 'POLLSTART', poll: pollData } as ChatPollStart)
                  } catch (e) {
                    console.error('[ChatWebSocket] Failed to parse POLLSTART in HISTORY:', e, 'Message:', msgStr.substring(0, 100))
                  }
                } else if (msgStr.startsWith('VOTECAST ')) {
                  try {
                    const voteData = JSON.parse(msgStr.substring(9))
                    this.emit('voteCast', { type: 'VOTECAST', vote: voteData } as ChatVoteCast)
                  } catch (e) {
                    console.error('[ChatWebSocket] Failed to parse VOTECAST in HISTORY:', e, 'Message:', msgStr.substring(0, 100))
                  }
                } else if (msgStr.startsWith('POLLSTOP ')) {
                  try {
                    const pollData = JSON.parse(msgStr.substring(9))
                    this.emit('pollStop', { type: 'POLLSTOP', poll: pollData } as ChatPollStop)
                  } catch (e) {
                    console.error('[ChatWebSocket] Failed to parse POLLSTOP in HISTORY:', e, 'Message:', msgStr.substring(0, 100))
                  }
                } else if (msgStr.startsWith('DEATH ')) {
                  try {
                    const deathData = JSON.parse(msgStr.substring('DEATH '.length)) as ChatDeathMessage
                    this.emit('death', { type: 'DEATH', death: deathData } as ChatDeathEvent)
                  } catch (e) {
                    console.error('[ChatWebSocket] Failed to parse DEATH in HISTORY:', e, 'Message:', msgStr.substring(0, 120))
                    fileLogger.writeWsDiscrepancy('chat', 'death_parse_error', {
                      preview: msgStr.substring(0, 2000),
                      error: e instanceof Error ? e.message : String(e),
                    })
                  }
                } else if (msgStr.startsWith('UNBAN ')) {
                  try {
                    const unbanData = JSON.parse(msgStr.substring('UNBAN '.length)) as ChatMessage
                    this.emit('unban', { type: 'UNBAN', unban: unbanData } as ChatUnbanEvent)
                  } catch (e) {
                    console.error('[ChatWebSocket] Failed to parse UNBAN in HISTORY:', e, 'Message:', msgStr.substring(0, 120))
                    fileLogger.writeWsDiscrepancy('chat', 'unban_parse_error', {
                      preview: msgStr.substring(0, 2000),
                      error: e instanceof Error ? e.message : String(e),
                    })
                  }
                } else if (msgStr.startsWith('SUBSCRIPTION ')) {
                  try {
                    const subData = JSON.parse(msgStr.substring('SUBSCRIPTION '.length)) as ChatSubscriptionEvent['subscription']
                    this.emit('subscription', { type: 'SUBSCRIPTION', subscription: subData } as ChatSubscriptionEvent)
                  } catch (e) {
                    console.error('[ChatWebSocket] Failed to parse SUBSCRIPTION in HISTORY:', e, 'Message:', msgStr.substring(0, 120))
                    fileLogger.writeWsDiscrepancy('chat', 'subscription_parse_error', {
                      preview: msgStr.substring(0, 2000),
                      error: e instanceof Error ? e.message : String(e),
                    })
                  }
                } else if (msgStr.startsWith('BROADCAST ')) {
                  try {
                    const broadcastData = JSON.parse(msgStr.substring('BROADCAST '.length)) as ChatBroadcastEvent['broadcast']
                    this.emit('broadcast', { type: 'BROADCAST', broadcast: broadcastData } as ChatBroadcastEvent)
                  } catch (e) {
                    console.error('[ChatWebSocket] Failed to parse BROADCAST in HISTORY:', e, 'Message:', msgStr.substring(0, 120))
                    fileLogger.writeWsDiscrepancy('chat', 'broadcast_parse_error', {
                      preview: msgStr.substring(0, 2000),
                      error: e instanceof Error ? e.message : String(e),
                    })
                  }
                } else if (msgStr.startsWith('BAN ')) {
                  try {
                    const data = JSON.parse(msgStr.substring(4)) as { data?: string; nick?: string; timestamp?: number }
                    this.emit('ban', { type: 'BAN', ban: data } as ChatBanEvent)
                  } catch (e) {
                    console.error('[ChatWebSocket] Failed to parse BAN in HISTORY:', e, 'Message:', msgStr.substring(0, 100))
                  }
                } else if (msgStr.startsWith('SUBONLY ')) {
                  try {
                    const data = JSON.parse(msgStr.substring(8)) as { data?: string; nick?: string; timestamp?: number }
                    this.emit('subonly', { type: 'SUBONLY', subonly: data } as ChatSubOnlyEvent)
                  } catch (e) {
                    console.error('[ChatWebSocket] Failed to parse SUBONLY in HISTORY:', e, 'Message:', msgStr.substring(0, 100))
                  }
                } else if (msgStr.startsWith('ADDPHRASE ')) {
                  try {
                    const data = JSON.parse(msgStr.substring(10)) as { data?: string; timestamp?: number }
                    this.emit('addphrase', { type: 'ADDPHRASE', phrase: data } as ChatPhraseEvent)
                  } catch (e) {
                    console.error('[ChatWebSocket] Failed to parse ADDPHRASE in HISTORY:', e, 'Message:', msgStr.substring(0, 100))
                  }
                } else if (msgStr.startsWith('REMOVEPHRASE ')) {
                  try {
                    const data = JSON.parse(msgStr.substring(12)) as { data?: string; timestamp?: number }
                    this.emit('removephrase', { type: 'REMOVEPHRASE', phrase: data } as ChatPhraseEvent)
                  } catch (e) {
                    console.error('[ChatWebSocket] Failed to parse REMOVEPHRASE in HISTORY:', e, 'Message:', msgStr.substring(0, 100))
                  }
                } else if (msgStr.startsWith('GIFTSUB ')) {
                  try {
                    const data = JSON.parse(msgStr.substring(8)) as ChatGiftSubEvent['giftSub']
                    this.emit('giftsub', { type: 'GIFTSUB', giftSub: data } as ChatGiftSubEvent)
                  } catch (e) {
                    console.error('[ChatWebSocket] Failed to parse GIFTSUB in HISTORY:', e, 'Message:', msgStr.substring(0, 120))
                  }
                } else if (msgStr.startsWith('MASSGIFT ')) {
                  try {
                    const data = JSON.parse(msgStr.substring(9)) as ChatMassGiftEvent['massGift']
                    this.emit('massgift', { type: 'MASSGIFT', massGift: data } as ChatMassGiftEvent)
                  } catch (e) {
                    console.error('[ChatWebSocket] Failed to parse MASSGIFT in HISTORY:', e, 'Message:', msgStr.substring(0, 120))
                  }
                } else if (msgStr.startsWith('DONATION ')) {
                  try {
                    const data = JSON.parse(msgStr.substring(9)) as ChatDonationEvent['donation']
                    this.emit('donation', { type: 'DONATION', donation: data } as ChatDonationEvent)
                  } catch (e) {
                    console.error('[ChatWebSocket] Failed to parse DONATION in HISTORY:', e, 'Message:', msgStr.substring(0, 120))
                  }
                } else {
                  console.log('[ChatWebSocket] Unsupported message type in HISTORY:', msgStr.substring(0, 50))
                  fileLogger.writeWsDiscrepancy('chat', 'unsupported_history_item', {
                    preview: msgStr.substring(0, 400),
                  })
                }
              } catch (e) {
                // Catch any unexpected errors in processing individual history items
                console.error('[ChatWebSocket] Unexpected error processing HISTORY item:', e, 'Message:', msgStr?.substring(0, 100) || 'unknown')
              }
            })

            if (parsedMessages.length > 0) {
              console.log(`[ChatWebSocket] Emitting history event with ${parsedMessages.length} messages`)
              this.emit('history', { type: 'HISTORY', messages: parsedMessages } as ChatHistoryMessage)
            } else {
              console.log('[ChatWebSocket] No messages parsed from HISTORY, skipping history event')
            }
          } catch (e) {
            console.error('[ChatWebSocket] Failed to parse HISTORY:', e, 'Raw message:', message.substring(0, 200))
            fileLogger.writeWsDiscrepancy('chat', 'history_parse_error', {
              preview: message.substring(0, 2000),
              error: e instanceof Error ? e.message : String(e),
            })
            // Don't rethrow - just log and continue
          }
        }
      } else if (message.startsWith('MSG ')) {
        // MSG {...}
        try {
          const msgData = JSON.parse(message.substring(4)) as ChatMessage
          this.emit('message', { type: 'MSG', message: msgData })
        } catch (e) {
          console.error('[ChatWebSocket] Failed to parse MSG:', e, 'Message:', message.substring(0, 100))
          fileLogger.writeWsDiscrepancy('chat', 'msg_parse_error', {
            preview: message.substring(0, 2000),
            error: e instanceof Error ? e.message : String(e),
          })
          // Continue processing - don't crash
        }
      } else if (message.startsWith('PRIVMSG ')) {
        // PRIVMSG { messageid, timestamp, nick, data }
        try {
          const privmsgData = JSON.parse(message.substring(8)) as ChatPrivMsg
          this.emit('privmsg', { type: 'PRIVMSG', privmsg: privmsgData } as ChatPrivMsgEvent)
        } catch (e) {
          console.error('[ChatWebSocket] Failed to parse PRIVMSG:', e, 'Message:', message.substring(0, 100))
          fileLogger.writeWsDiscrepancy('chat', 'privmsg_parse_error', {
            preview: message.substring(0, 500),
            error: e instanceof Error ? e.message : String(e),
          })
        }
      } else if (message.startsWith('JOIN ')) {
        // JOIN {...}
        try {
          const userData = JSON.parse(message.substring(5)) as ChatMessage
          this.emit('userEvent', { type: 'JOIN', user: userData } as ChatUserEvent)
        } catch (e) {
          console.error('[ChatWebSocket] Failed to parse JOIN:', e, 'Message:', message.substring(0, 100))
          fileLogger.writeWsDiscrepancy('chat', 'join_parse_error', {
            preview: message.substring(0, 2000),
            error: e instanceof Error ? e.message : String(e),
          })
          // Continue processing - don't crash
        }
      } else if (message.startsWith('QUIT ')) {
        // QUIT {...}
        try {
          const userData = JSON.parse(message.substring(5)) as ChatMessage
          this.emit('userEvent', { type: 'QUIT', user: userData } as ChatUserEvent)
        } catch (e) {
          console.error('[ChatWebSocket] Failed to parse QUIT:', e, 'Message:', message.substring(0, 100))
          fileLogger.writeWsDiscrepancy('chat', 'quit_parse_error', {
            preview: message.substring(0, 2000),
            error: e instanceof Error ? e.message : String(e),
          })
          // Continue processing - don't crash
        }
      } else if (message.startsWith('UPDATEUSER ')) {
        // UPDATEUSER {...}
        try {
          // 'UPDATEUSER ' is 11 chars; substring(11) preserves the opening '{'
          const jsonPart = message.substring(11).trim()
          
          // Check if JSON looks complete (basic validation)
          if (!jsonPart || jsonPart.length === 0) {
            console.error('[ChatWebSocket] UPDATEUSER has empty JSON part. Full message length:', message.length)
            console.error('[ChatWebSocket] Full message:', message)
            return
          }
          
          // Try to parse directly - JSON.parse will throw if invalid
          // The brace counting was too strict and incorrectly flagged valid JSON
          const userData = JSON.parse(jsonPart) as ChatMessage
          this.emit('userEvent', { type: 'UPDATEUSER', user: userData } as ChatUserEvent)
        } catch (e) {
          // Only log if it's actually a parse error, not a validation error
          console.error('[ChatWebSocket] Failed to parse UPDATEUSER:', e)
          console.error('[ChatWebSocket] Message length:', message.length)
          console.error('[ChatWebSocket] Full message:', message)
          console.error('[ChatWebSocket] JSON part (first 200 chars):', message.substring(11, 211))
          fileLogger.writeWsDiscrepancy('chat', 'updateuser_parse_error', {
            preview: message.substring(0, 2000),
            error: e instanceof Error ? e.message : String(e),
          })
          // Continue processing - don't crash
        }
      } else if (message.startsWith('PAIDEVENTS')) {
        // PAIDEVENTS [...] or PAIDEVENTS []
        try {
          let eventsData: any[] = []
          let jsonPart: string
          if (message.startsWith('PAIDEVENTS ')) {
            // "PAIDEVENTS []" - extract everything after the space
            jsonPart = message.substring(11).trim()
          } else {
            // "PAIDEVENTS[]" - extract everything after "PAIDEVENTS"
            jsonPart = message.substring(10).trim()
          }
          
          if (jsonPart && jsonPart.length > 0) {
            eventsData = JSON.parse(jsonPart) as any[]
          }
          
          this.emit('paidEvents', { type: 'PAIDEVENTS', events: eventsData } as ChatPaidEvents)
        } catch (e) {
          console.error('[ChatWebSocket] Failed to parse PAIDEVENTS:', e)
          console.error('[ChatWebSocket] Full message:', message)
          console.error('[ChatWebSocket] Extracted JSON part:', message.startsWith('PAIDEVENTS ') ? message.substring(11) : message.substring(10))
        }
      } else if (message.startsWith('PIN ')) {
        // PIN {...}
        try {
          const pinData = JSON.parse(message.substring(4)) as ChatPinMessage
          this.emit('pin', { type: 'PIN', pin: pinData } as ChatPin)
        } catch (e) {
          console.error('[ChatWebSocket] Failed to parse PIN:', e, 'Message:', message.substring(0, 100))
          // Continue processing - don't crash
        }
      } else if (message.startsWith('NAMES ')) {
        // NAMES {...}
        try {
          const namesData = JSON.parse(message.substring(6))
          this.emit('names', { type: 'NAMES', names: namesData } as ChatNames)
        } catch (e) {
          console.error('[ChatWebSocket] Failed to parse NAMES:', e, 'Message:', message.substring(0, 100))
          // Continue processing - don't crash
        }
      } else if (message.startsWith('MUTE ')) {
        // MUTE {...}
        try {
          const muteData = JSON.parse(message.substring(5))
          this.emit('mute', { type: 'MUTE', mute: muteData } as ChatMute)
        } catch (e) {
          console.error('[ChatWebSocket] Failed to parse MUTE:', e, 'Message:', message.substring(0, 100))
          // Continue processing - don't crash
        }
      } else if (message.startsWith('UNMUTE ')) {
        // UNMUTE {...} — user was unmuted (semantically: unbanned from chat)
        try {
          const unmuteData = JSON.parse(message.substring(7)) as ChatMessage
          this.emit('unmute', { type: 'UNMUTE', unmute: unmuteData } as ChatUnmute)
        } catch (e) {
          console.error('[ChatWebSocket] Failed to parse UNMUTE:', e, 'Message:', message.substring(0, 100))
          fileLogger.writeWsDiscrepancy('chat', 'unmute_parse_error', {
            preview: message.substring(0, 2000),
            error: e instanceof Error ? e.message : String(e),
          })
        }
      } else if (message.startsWith('ME ')) {
        // ME null or ME {...}
        try {
          const meData = message.substring(3).trim()
          const parsedData = meData === 'null' ? null : JSON.parse(meData)
          this.emit('me', { type: 'ME', data: parsedData } as ChatMe)
        } catch (e) {
          console.error('[ChatWebSocket] Failed to parse ME:', e, 'Message:', message.substring(0, 100))
          // Continue processing - don't crash
        }
      } else if (message.startsWith('POLLSTART ')) {
        // POLLSTART {...}
        try {
          const pollData = JSON.parse(message.substring(10))
          this.emit('pollStart', { type: 'POLLSTART', poll: pollData } as ChatPollStart)
        } catch (e) {
          console.error('[ChatWebSocket] Failed to parse POLLSTART:', e, 'Message:', message.substring(0, 100))
          // Continue processing - don't crash
        }
      } else if (message.startsWith('VOTECAST ')) {
        // VOTECAST {...}
        try {
          const voteData = JSON.parse(message.substring(9))
          this.emit('voteCast', { type: 'VOTECAST', vote: voteData } as ChatVoteCast)
        } catch (e) {
          console.error('[ChatWebSocket] Failed to parse VOTECAST:', e, 'Message:', message.substring(0, 100))
          // Continue processing - don't crash
        }
      } else if (message.startsWith('POLLSTOP ')) {
        // POLLSTOP {...}
        try {
          const pollData = JSON.parse(message.substring(9))
          this.emit('pollStop', { type: 'POLLSTOP', poll: pollData } as ChatPollStop)
        } catch (e) {
          console.error('[ChatWebSocket] Failed to parse POLLSTOP:', e, 'Message:', message.substring(0, 100))
          // Continue processing - don't crash
        }
      } else if (message.startsWith('VOTECOUNTED ')) {
        try {
          const data = JSON.parse(message.substring(12)) as { vote?: string }
          this.emit('voteCounted', { vote: data?.vote ?? '' })
        } catch (e) {
          console.error('[ChatWebSocket] Failed to parse VOTECOUNTED:', e, 'Message:', message.substring(0, 100))
        }
      } else if (message.startsWith('ERR ')) {
        try {
          const data = JSON.parse(message.substring(4)) as { description?: string }
          if (data?.description === 'alreadyvoted' || data?.description) {
            this.emit('pollVoteError', { description: data.description })
          }
          if (data?.description) {
            this.emit('chatErr', { description: data.description })
          }
        } catch (e) {
          console.error('[ChatWebSocket] Failed to parse ERR:', e, 'Message:', message.substring(0, 100))
        }
      } else if (message.startsWith('DEATH ')) {
        // DEATH {...}
        try {
          const deathData = JSON.parse(message.substring('DEATH '.length)) as ChatDeathMessage
          this.emit('death', { type: 'DEATH', death: deathData } as ChatDeathEvent)
        } catch (e) {
          console.error('[ChatWebSocket] Failed to parse DEATH:', e, 'Message:', message.substring(0, 120))
          fileLogger.writeWsDiscrepancy('chat', 'death_parse_error', {
            preview: message.substring(0, 2000),
            error: e instanceof Error ? e.message : String(e),
          })
        }
      } else if (message.startsWith('UNBAN ')) {
        // UNBAN {...}
        try {
          const unbanData = JSON.parse(message.substring('UNBAN '.length)) as ChatMessage
          this.emit('unban', { type: 'UNBAN', unban: unbanData } as ChatUnbanEvent)
        } catch (e) {
          console.error('[ChatWebSocket] Failed to parse UNBAN:', e, 'Message:', message.substring(0, 120))
          fileLogger.writeWsDiscrepancy('chat', 'unban_parse_error', {
            preview: message.substring(0, 2000),
            error: e instanceof Error ? e.message : String(e),
          })
        }
      } else if (message.startsWith('SUBSCRIPTION ')) {
        // SUBSCRIPTION {...}
        try {
          const subData = JSON.parse(message.substring('SUBSCRIPTION '.length)) as ChatSubscriptionEvent['subscription']
          this.emit('subscription', { type: 'SUBSCRIPTION', subscription: subData } as ChatSubscriptionEvent)
        } catch (e) {
          console.error('[ChatWebSocket] Failed to parse SUBSCRIPTION:', e, 'Message:', message.substring(0, 120))
          fileLogger.writeWsDiscrepancy('chat', 'subscription_parse_error', {
            preview: message.substring(0, 2000),
            error: e instanceof Error ? e.message : String(e),
          })
        }
      } else if (message.startsWith('BROADCAST ')) {
        // BROADCAST {...}
        try {
          const broadcastData = JSON.parse(message.substring('BROADCAST '.length)) as ChatBroadcastEvent['broadcast']
          this.emit('broadcast', { type: 'BROADCAST', broadcast: broadcastData } as ChatBroadcastEvent)
        } catch (e) {
          console.error('[ChatWebSocket] Failed to parse BROADCAST:', e, 'Message:', message.substring(0, 120))
          fileLogger.writeWsDiscrepancy('chat', 'broadcast_parse_error', {
            preview: message.substring(0, 2000),
            error: e instanceof Error ? e.message : String(e),
          })
        }
      } else if (message.startsWith('BAN ')) {
        try {
          const data = JSON.parse(message.substring(4)) as { data?: string; nick?: string; timestamp?: number }
          this.emit('ban', { type: 'BAN', ban: data } as ChatBanEvent)
        } catch (e) {
          console.error('[ChatWebSocket] Failed to parse BAN:', e, 'Message:', message.substring(0, 100))
        }
      } else if (message.startsWith('SUBONLY ')) {
        try {
          const data = JSON.parse(message.substring(8)) as { data?: string; nick?: string; timestamp?: number }
          this.emit('subonly', { type: 'SUBONLY', subonly: data } as ChatSubOnlyEvent)
        } catch (e) {
          console.error('[ChatWebSocket] Failed to parse SUBONLY:', e, 'Message:', message.substring(0, 100))
        }
      } else if (message === 'RELOAD' || message.startsWith('RELOAD ')) {
        this.emit('reload', { type: 'RELOAD' } as ChatReloadEvent)
      } else if (message === 'PRIVMSGSENT' || message.startsWith('PRIVMSGSENT ')) {
        this.emit('privmsgsent', { type: 'PRIVMSGSENT' } as ChatPrivMsgSentEvent)
      } else if (message.startsWith('ADDPHRASE ')) {
        try {
          const data = JSON.parse(message.substring(10)) as { data?: string; timestamp?: number }
          this.emit('addphrase', { type: 'ADDPHRASE', phrase: data } as ChatPhraseEvent)
        } catch (e) {
          console.error('[ChatWebSocket] Failed to parse ADDPHRASE:', e, 'Message:', message.substring(0, 100))
        }
      } else if (message.startsWith('REMOVEPHRASE ')) {
        try {
          const data = JSON.parse(message.substring(12)) as { data?: string; timestamp?: number }
          this.emit('removephrase', { type: 'REMOVEPHRASE', phrase: data } as ChatPhraseEvent)
        } catch (e) {
          console.error('[ChatWebSocket] Failed to parse REMOVEPHRASE:', e, 'Message:', message.substring(0, 100))
        }
      } else if (message.startsWith('GIFTSUB ')) {
        try {
          const data = JSON.parse(message.substring(8)) as ChatGiftSubEvent['giftSub']
          this.emit('giftsub', { type: 'GIFTSUB', giftSub: data } as ChatGiftSubEvent)
        } catch (e) {
          console.error('[ChatWebSocket] Failed to parse GIFTSUB:', e, 'Message:', message.substring(0, 120))
        }
      } else if (message.startsWith('MASSGIFT ')) {
        try {
          const data = JSON.parse(message.substring(9)) as ChatMassGiftEvent['massGift']
          this.emit('massgift', { type: 'MASSGIFT', massGift: data } as ChatMassGiftEvent)
        } catch (e) {
          console.error('[ChatWebSocket] Failed to parse MASSGIFT:', e, 'Message:', message.substring(0, 120))
        }
      } else if (message.startsWith('DONATION ')) {
        try {
          const data = JSON.parse(message.substring(9)) as ChatDonationEvent['donation']
          this.emit('donation', { type: 'DONATION', donation: data } as ChatDonationEvent)
        } catch (e) {
          console.error('[ChatWebSocket] Failed to parse DONATION:', e, 'Message:', message.substring(0, 120))
        }
      } else {
        console.log('[ChatWebSocket] Unsupported message type:', message.substring(0, 100))
        console.log('[ChatWebSocket] Full unsupported message:', message)
        fileLogger.writeWsDiscrepancy('chat', 'unsupported_message', {
          preview: message.substring(0, 2000),
          length: message.length,
        })
      }
    } catch (error) {
      // Catch any unexpected errors in message handling
      // This should never happen, but if it does, log it and continue
      console.error('[ChatWebSocket] Unexpected error handling message:', error)
      console.error('[ChatWebSocket] Message that caused error:', message?.substring(0, 200) || 'unknown')
      fileLogger.writeWsDiscrepancy('chat', 'handler_exception', {
        preview: message?.substring(0, 2000) || 'unknown',
        error: error instanceof Error ? error.message : String(error),
      })
      // Don't rethrow - just log and continue processing
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
