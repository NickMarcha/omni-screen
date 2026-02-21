/**
 * Temporary diagnostic counters for primary chat MSG flow (renderer).
 * Used by Debug page to identify where messages are dropped.
 */

export interface PrimaryChatRendererCounters {
  /** chat-websocket-message dispatched by chatWsClient (handler received) */
  wsClientDispatched: number
  /** No handler registered for chat-websocket-message */
  wsClientNoHandler: number
  /** handleMessage pushed to queue (CombinedChat) */
  combinedChatReceived: number
  /** appendItems called with primary MSG count (CombinedChat flush) */
  combinedChatAppended: number
  /** tryAddPrimaryChatMessage rejected (duplicate) */
  combinedChatRejectedDuplicate: number
}

const counters: PrimaryChatRendererCounters = {
  wsClientDispatched: 0,
  wsClientNoHandler: 0,
  combinedChatReceived: 0,
  combinedChatAppended: 0,
  combinedChatRejectedDuplicate: 0,
}

export function incrementWsClientDispatched(): void {
  counters.wsClientDispatched++
}

export function incrementWsClientNoHandler(): void {
  counters.wsClientNoHandler++
}

export function incrementCombinedChatReceived(): void {
  counters.combinedChatReceived++
}

export function incrementCombinedChatAppended(count: number): void {
  counters.combinedChatAppended += count
}

export function incrementCombinedChatRejectedDuplicate(): void {
  counters.combinedChatRejectedDuplicate++
}

export function getPrimaryChatRendererCounters(): PrimaryChatRendererCounters {
  return { ...counters }
}

export function resetPrimaryChatRendererCounters(): void {
  counters.wsClientDispatched = 0
  counters.wsClientNoHandler = 0
  counters.combinedChatReceived = 0
  counters.combinedChatAppended = 0
  counters.combinedChatRejectedDuplicate = 0
}
