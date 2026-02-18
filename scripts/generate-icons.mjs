/**
 * Generate app icons from src/assets/logo-filled.svg and copy logos to public.
 * Outputs:
 *   - build/icon.png (512x512) for electron-builder (Windows, macOS, Linux)
 *   - public/icon.png (512x512) for runtime window icon (taskbar, etc.)
 *   - public/YeeCharm.gif (copied from src/assets/media/) for loading screen
 *
 * Run: node scripts/generate-icons.mjs
 * Or: npm run icons
 */

import sharp from 'sharp'
import { copyFile, mkdir, writeFile } from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const svgPath = path.join(root, 'src', 'assets', 'logo-filled.svg')
const buildDir = path.join(root, 'build')
const buildIconPath = path.join(buildDir, 'icon.png')
const publicDir = path.join(root, 'public')
const publicIconPath = path.join(publicDir, 'icon.png')

const SIZE = 512

async function main() {
  const svg = await sharp(svgPath)
  const png = await svg
    .resize(SIZE, SIZE, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer()

  await mkdir(buildDir, { recursive: true })
  await mkdir(publicDir, { recursive: true })
  await writeFile(buildIconPath, png)
  await writeFile(publicIconPath, png)

  const yeeCharmSrc = path.join(root, 'src', 'assets', 'media', 'YeeCharm.gif')
  const yeeCharmDest = path.join(publicDir, 'YeeCharm.gif')
  await copyFile(yeeCharmSrc, yeeCharmDest)

  console.log(`Generated ${SIZE}x${SIZE} icon:`)
  console.log(`  ${buildIconPath}`)
  console.log(`  ${publicIconPath}`)
  console.log(`Copied logo to public:`)
  console.log(`  ${yeeCharmDest}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
