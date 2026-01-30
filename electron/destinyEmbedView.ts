/**
 * Single-instance BrowserView for the Destiny.gg embedded chat.
 * Uses partition persist:main so login is shared with the login window.
 * Injects d.gg utilities userscript on load.
 * Supports detach: move the one view to a separate window; closing that window re-attaches to main.
 */

import { BrowserView, BrowserWindow, session, WebContents } from 'electron'

const EMBED_URL = 'https://www.destiny.gg/embed/chat?omni=1'
const DGG_UTILITIES_SCRIPT_URL =
  'https://github.com/vyneer/dgg-chat-gui-scripts/raw/4e1c687e236588fac0e15061cede5ac312cc5e79/dgg-utilities.user.js'

let embedView: BrowserView | null = null
let detachedWin: BrowserWindow | null = null
let lastMainBounds: { x: number; y: number; width: number; height: number } | null = null
let mainWindowRef: BrowserWindow | null = null

function getOrCreateView(): BrowserView {
  if (embedView?.webContents && !embedView.webContents.isDestroyed()) {
    return embedView
  }
  embedView = null
  const view = new BrowserView({
    webPreferences: {
      partition: 'persist:main',
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
    },
  })
  view.webContents.on('did-finish-load', () => {
    // Inject soon and retry for late-loaded iframes (chat may be in an iframe)
    injectDggUtilities(view).catch(() => {})
    setTimeout(() => injectDggUtilities(view).catch(() => {}), 800)
    setTimeout(() => injectDggUtilities(view).catch(() => {}), 2500)
  })
  view.setAutoResize({ width: true, height: true })
  view.webContents.loadURL(EMBED_URL)
  embedView = view
  return view
}

// Tampermonkey/Greasemonkey API stub so d.gg utilities (and similar userscripts) don't throw.
// d.gg utilities uses GM.xmlHttpRequest, GM.registerMenuCommand, and GM_info.script.version.
const GM_STUB_SCRIPT = `
(function() {
  var prefix = 'omni_gm_';
  if (window.GM_info) return;

  window.GM_info = {
    script: { version: '1.9', name: 'd.gg utilities' },
    scriptMetaStr: ''
  };

  window.GM_getValue = function(name, def) {
    try {
      var v = localStorage.getItem(prefix + name);
      return v !== null ? JSON.parse(v) : def;
    } catch (e) { return def; }
  };
  window.GM_setValue = function(name, value) {
    try { localStorage.setItem(prefix + name, JSON.stringify(value)); } catch (e) {}
  };
  window.GM_deleteValue = function(name) {
    try { localStorage.removeItem(prefix + name); } catch (e) {}
  };
  window.GM_listValues = function() {
    try {
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(prefix) === 0) keys.push(k.slice(prefix.length));
      }
      return keys;
    } catch (e) { return []; }
  };
  window.GM_addStyle = function(css) {
    var el = document.createElement('style');
    el.textContent = css;
    (document.head || document.documentElement).appendChild(el);
  };
  function doXmlHttpRequest(d) {
    var url = d.url, method = (d.method || 'GET').toUpperCase();
    var opts = { method: method, headers: d.headers || {} };
    if (d.data && method !== 'GET') opts.body = typeof d.data === 'string' ? d.data : JSON.stringify(d.data);
    fetch(url, opts).then(function(r) {
      var headers = '';
      r.headers.forEach(function(v, k) { headers += k + ': ' + v + '\\n'; });
      return r.text().then(function(text) {
        if (d.onload) d.onload({ response: text, responseText: text, status: r.status, statusText: r.statusText, responseHeaders: headers });
      });
    }).catch(function(err) {
      if (d.onerror) d.onerror(err);
    });
  }
  window.GM_xmlhttpRequest = doXmlHttpRequest;
  window.GM = {
    xmlHttpRequest: doXmlHttpRequest,
    registerMenuCommand: function() {},
    getValue: window.GM_getValue,
    setValue: window.GM_setValue,
    openInTab: function(url) { window.open(url); }
  };
  window.GM_openInTab = function(url) { window.open(url); };
  window.GM_registerMenuCommand = function() {};
  window.GM_getResourceText = function() { return ''; };
  window.GM_getResourceURL = function() { return ''; };
  window.unsafeWindow = window;
})();
`

async function injectInFrame(
  frame: { isDestroyed: () => boolean; executeJavaScript: (code: string, userGesture?: boolean) => Promise<unknown> },
  scriptText: string,
  key: string
): Promise<boolean> {
  if (frame.isDestroyed()) return false
  const injectScript = `(function(){ if (window.${key}) return; window.${key}=true; var s=document.createElement('script'); s.textContent=${JSON.stringify(scriptText)}; (document.head||document.documentElement).appendChild(s); })();`
  try {
    await frame.executeJavaScript(GM_STUB_SCRIPT, true)
    await frame.executeJavaScript(injectScript, true)
    return true
  } catch {
    return false
  }
}

async function injectDggUtilities(view: BrowserView): Promise<void> {
  const wc = view.webContents
  if (wc.isDestroyed()) return
  try {
    const ses = session.fromPartition('persist:main')
    const res = await ses.fetch(DGG_UTILITIES_SCRIPT_URL)
    if (!res.ok) {
      console.error('[destiny-embed] d.gg utilities fetch failed:', res.status, res.statusText)
      return
    }
    const scriptText = await res.text()
    if (!scriptText || scriptText.length > 5_000_000) {
      console.error('[destiny-embed] d.gg utilities script empty or too large')
      return
    }
    const key = '__omni_dgg_utilities_injected'
    const mainFrame = wc.mainFrame
    // Inject into all frames (main + iframes); chat UI may live in a child frame.
    const frames = mainFrame.framesInSubtree ?? [mainFrame]
    let injected = 0
    for (const frame of frames) {
      if (frame.isDestroyed()) continue
      const ok = await injectInFrame(frame, scriptText, key)
      if (ok) {
        injected++
        // Log frame URL for debugging (chat may be in an iframe)
        try {
          const url = 'url' in frame ? String((frame as { url: string }).url).slice(0, 80) : ''
          if (url) console.log('[destiny-embed] injected into frame:', url)
        } catch {
          /* ignore */
        }
      }
    }
    if (injected > 0) {
      console.log('[destiny-embed] d.gg utilities injected into', injected, 'frame(s)')
    }
  } catch (e) {
    console.error('[destiny-embed] d.gg utilities injection failed:', e instanceof Error ? e.message : e)
  }
}

export function setMainWindowRef(win: BrowserWindow | null): void {
  mainWindowRef = win
}

function normalizeBounds(bounds: unknown): { x: number; y: number; width: number; height: number } | null {
  if (!bounds || typeof bounds !== 'object') return null
  const b = bounds as Record<string, unknown>
  const x = Number(b.x)
  const y = Number(b.y)
  const width = Number(b.width)
  const height = Number(b.height)
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) return null
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  }
}

export function setBounds(mainWindow: BrowserWindow | null, bounds: unknown): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (detachedWin) return // view is in detached window; don't move it
  const safe = normalizeBounds(bounds)
  if (!safe) return
  const view = getOrCreateView()
  mainWindow.setBrowserView(view)
  const final = { ...safe }
  lastMainBounds = final
  view.setBounds(final)
}

export function hide(mainWindow: BrowserWindow | null): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.setBrowserView(null)
}

export function detach(mainWindow: BrowserWindow | null): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (detachedWin) return
  const view = getOrCreateView()
  mainWindow.setBrowserView(null)
  const w = 420
  const h = 700
  detachedWin = new BrowserWindow({
    width: w + 32,
    height: h + 64,
    title: 'Destiny.gg Chat',
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })
  detachedWin.setMaxListeners(20)
  detachedWin.setBrowserView(view)
  view.setBounds({ x: 0, y: 0, width: w, height: h })
  detachedWin.on('closed', () => {
    detachedWin = null
    try {
      if (mainWindowRef && !mainWindowRef.isDestroyed() && embedView?.webContents && !embedView.webContents.isDestroyed()) {
        mainWindowRef.setBrowserView(embedView)
        if (lastMainBounds) {
          embedView.setBounds(lastMainBounds)
        }
        mainWindowRef.webContents.send('destiny-embed-reattached')
      }
    } catch (e) {
      console.error('[destiny-embed] reattach failed:', e instanceof Error ? e.message : e)
    }
  })
}

export function isDetached(): boolean {
  return !!detachedWin
}

export function reload(): void {
  if (embedView?.webContents && !embedView.webContents.isDestroyed()) {
    embedView.webContents.reload()
  }
}

export function openDevTools(): void {
  if (embedView?.webContents && !embedView.webContents.isDestroyed()) {
    embedView.webContents.openDevTools()
  }
}

/** Return the embed's webContents so main can attach link handlers (will-navigate, setWindowOpenHandler). */
export function getEmbedWebContents(): WebContents | null {
  if (embedView?.webContents && !embedView.webContents.isDestroyed()) {
    return embedView.webContents
  }
  return null
}
