/// <reference types="vite/client" />

// Electron webview typing (used for userscript injection into embeds)
declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: any
    }
  }
}

