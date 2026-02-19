/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CHARITY_RAFFLE: boolean
}

// Electron webview typing (used for userscript injection into embeds)
declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: any
    }
  }

}

