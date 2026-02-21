import { defineConfig } from 'vite'
import path from 'node:path'
import fs from 'node:fs'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Build-time feature flag for charity raffle (DGG Against Malaria). Set CHARITY_RAFFLE_ENABLED=1 to include.
const charityRaffleEnabled = process.env.CHARITY_RAFFLE_ENABLED === '1'

/** Copy notification sounds to dist so they're available in production. */
function copyNotificationSoundsPlugin() {
  return {
    name: 'copy-notification-sounds',
    closeBundle() {
      const src = path.resolve(__dirname, 'src/assets/media/sound/notification')
      const dest = path.resolve(__dirname, 'dist/assets/media/sound/notification')
      if (!fs.existsSync(src)) return
      fs.mkdirSync(dest, { recursive: true })
      for (const name of fs.readdirSync(src)) {
        const ext = path.extname(name).toLowerCase()
        if (['.mp3', '.wav', '.ogg', '.m4a', '.aac'].includes(ext) || name.toLowerCase().endsWith('.txt')) {
          fs.copyFileSync(path.join(src, name), path.join(dest, name))
        }
      }
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  define: {
    'process.env.CHARITY_RAFFLE_ENABLED': JSON.stringify(charityRaffleEnabled ? '1' : '0'),
    '__CHARITY_RAFFLE_ENABLED__': JSON.stringify(charityRaffleEnabled),
    'import.meta.env.VITE_CHARITY_RAFFLE': JSON.stringify(charityRaffleEnabled),
  },
  plugins: [
    tailwindcss(),
    react(),
    copyNotificationSoundsPlugin(),
    electron({
      main: {
        // Shortcut of `build.lib.entry`.
        entry: 'electron/main.ts',
        vite: {
          define: {
            '__CHARITY_RAFFLE_ENABLED__': JSON.stringify(charityRaffleEnabled),
          },
          build: {
            rollupOptions: {
              external: ['ws']
            }
          }
        }
      },
      preload: {
        // Shortcut of `build.rollupOptions.input`.
        // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
        input: path.join(__dirname, 'electron/preload.ts'),
      },
      // Ployfill the Electron and Node.js API for Renderer process.
      // If you want use Node.js in Renderer process, the `nodeIntegration` needs to be enabled in the Main process.
      // See 👉 https://github.com/electron-vite/vite-plugin-electron-renderer
      renderer: process.env.NODE_ENV === 'test'
        // https://github.com/electron-vite/vite-plugin-electron-renderer/issues/78#issuecomment-2053600808
        ? undefined
        : {},
    }),
  ],
})
