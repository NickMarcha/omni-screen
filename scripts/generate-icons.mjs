/**
 * Generate app icons from src/assets/logo-filled.svg.
 * Outputs:
 *   - build/icon.png (512x512) for electron-builder (Windows, macOS, Linux)
 *   - public/icon.png (512x512) for runtime window icon (taskbar, etc.)
 *
 * Run: node scripts/generate-icons.mjs
 * Or: npm run icons
 */

import sharp from 'sharp'
import { mkdir, writeFile } from 'fs/promises'
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

  console.log(`Generated ${SIZE}x${SIZE} icon:`)
  console.log(`  ${buildIconPath}`)
  console.log(`  ${publicIconPath}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
