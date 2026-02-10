/**
 * Extension manifest (from update URL / install).
 * One extension can declare multiple capabilities; the app uses only what it supports.
 */
export interface ExtensionManifest {
  /** Unique id (e.g. chat source id). Used as folder name and in registry. */
  id: string
  /** Display name. */
  name: string
  /** Semantic version for update checks. */
  version: string
  /** URL of this manifest; app re-fetches this to check for updates. */
  updateUrl: string
  /** URL of the extension bundle to download (zip or single JS). */
  entry: string
  /** Optional: short description for the extensions UI. */
  description?: string
  /** Optional: tags for discovery (e.g. ["chat", "embeds"]). */
  tags?: string[]
  /** Optional: URL of icon image (shown in community list and installed list). */
  icon?: string
  /** Optional: capabilities this extension provides (chat, embeds, emotes, flairs, etc.). */
  capabilities?: string[]
}

/**
 * Installed extension record (persisted in extensions.json).
 */
export interface InstalledExtension {
  id: string
  name: string
  version: string
  updateUrl: string
  /** Path to the extension folder (relative to userData or absolute). */
  path: string
  /** Whether the extension is enabled (load at startup). */
  enabled: boolean
  /** When the extension was installed (ISO string). */
  installedAt: string
  /** From manifest: short description. */
  description?: string
  /** From manifest: tags. */
  tags?: string[]
  /** From manifest: URL of icon image. */
  icon?: string
}

/**
 * Result of handling a protocol URL (e.g. install success/failure).
 * For add-streamer, streamer is the new bookmarked streamer object (shape matches renderer BookmarkedStreamer).
 */
export interface ProtocolHandleResult {
  ok: boolean
  operation: string
  message?: string
  extensionId?: string
  /** Set when operation is add-streamer; renderer should merge into bookmarked streamers. */
  streamer?: Record<string, unknown>
}

/**
 * Placement for extension settings in the app UI.
 * - omni_screen: shown in Settings > Extensions under this extension.
 * - link_scroller: reserved for Link Scroller-specific extension settings.
 * - connections: reserved for login/connections (e.g. add platform to Connections list).
 */
export type ExtensionSettingsPlacement = 'omni_screen' | 'link_scroller' | 'connections'

export interface ExtensionSettingField {
  key: string
  type: 'boolean' | 'string' | 'number'
  label: string
  default: boolean | string | number
  description?: string
  /** For type 'string', optional placeholder. */
  placeholder?: string
}

export interface ExtensionSettingsSection {
  id: string
  label: string
  placement: ExtensionSettingsPlacement
  fields: ExtensionSettingField[]
}
