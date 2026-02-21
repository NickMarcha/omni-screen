/**
 * Temporary diagnostic counters for primary chat MSG flow.
 * Used by Debug page to identify where messages are dropped.
 */

export interface PrimaryChatDebugCounters {
  /** MSG received and emitted by ChatWebSocket (main process) */
  mainReceived: number
  /** Broadcast attempted but dropped (clients.size === 0) */
  mainBroadcastDroppedNoClients: number
  /** Broadcast sent to at least one client */
  mainBroadcastSent: number
}

const counters: PrimaryChatDebugCounters = {
  mainReceived: 0,
  mainBroadcastDroppedNoClients: 0,
  mainBroadcastSent: 0,
}

export function incrementMainReceived(): void {
  counters.mainReceived++
}

export function incrementMainBroadcastDroppedNoClients(): void {
  counters.mainBroadcastDroppedNoClients++
}

export function incrementMainBroadcastSent(): void {
  counters.mainBroadcastSent++
}

export function getPrimaryChatDebugCounters(): PrimaryChatDebugCounters {
  return { ...counters }
}

export function resetPrimaryChatDebugCounters(): void {
  counters.mainReceived = 0
  counters.mainBroadcastDroppedNoClients = 0
  counters.mainBroadcastSent = 0
}
