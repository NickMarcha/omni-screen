import WebSocket from 'ws'
import { EventEmitter } from 'events'

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

export type ChatWebSocketEvent = ChatHistoryMessage | ChatUserEvent | ChatPaidEvents | ChatPin | ChatNames | ChatMute | ChatMe | ChatPollStart | ChatVoteCast | ChatPollStop | { type: 'MSG'; message: ChatMessage }

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

  constructor(url: string = 'wss://chat.destiny.gg/ws') {
    super()
    this.url = url
  }

  /**
   * Connect to the WebSocket server
   */
  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      console.log('[ChatWebSocket] Already connected or connecting')
      return
    }

    this.isIntentionallyClosed = false
    console.log(`[ChatWebSocket] Connecting to ${this.url}...`)

    try {
      this.ws = new WebSocket(this.url)

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
        // Log error details safely
        const errorMessage = error?.message || String(error) || 'Unknown error'
        const errorStack = error?.stack || 'No stack trace'
        console.error('[ChatWebSocket] Error:', errorMessage)
        console.error('[ChatWebSocket] Error stack:', errorStack)
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
      
      // Remove all event listeners to prevent errors during close
      this.ws.removeAllListeners()
      
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
                } else {
                  console.log('[ChatWebSocket] Unsupported message type in HISTORY:', msgStr.substring(0, 50))
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
          // Continue processing - don't crash
        }
      } else if (message.startsWith('JOIN ')) {
        // JOIN {...}
        try {
          const userData = JSON.parse(message.substring(5)) as ChatMessage
          this.emit('userEvent', { type: 'JOIN', user: userData } as ChatUserEvent)
        } catch (e) {
          console.error('[ChatWebSocket] Failed to parse JOIN:', e, 'Message:', message.substring(0, 100))
          // Continue processing - don't crash
        }
      } else if (message.startsWith('QUIT ')) {
        // QUIT {...}
        try {
          const userData = JSON.parse(message.substring(5)) as ChatMessage
          this.emit('userEvent', { type: 'QUIT', user: userData } as ChatUserEvent)
        } catch (e) {
          console.error('[ChatWebSocket] Failed to parse QUIT:', e, 'Message:', message.substring(0, 100))
          // Continue processing - don't crash
        }
      } else if (message.startsWith('UPDATEUSER ')) {
        // UPDATEUSER {...}
        try {
          const jsonPart = message.substring(12).trim()
          
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
          console.error('[ChatWebSocket] JSON part (first 200 chars):', message.substring(12, 212))
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
      } else {
        console.log('[ChatWebSocket] Unsupported message type:', message.substring(0, 100))
        console.log('[ChatWebSocket] Full unsupported message:', message)
      }
    } catch (error) {
      // Catch any unexpected errors in message handling
      // This should never happen, but if it does, log it and continue
      console.error('[ChatWebSocket] Unexpected error handling message:', error)
      console.error('[ChatWebSocket] Message that caused error:', message?.substring(0, 200) || 'unknown')
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
