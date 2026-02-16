import pieChartSvg from '../assets/icons/feathericons/pie-chart.svg?raw'
import plusSquareSvg from '../assets/icons/feathericons/plus-square.svg?raw'
import imageSvg from '../assets/icons/feathericons/image.svg?raw'
import volumeXSvg from '../assets/icons/feathericons/volume-x.svg?raw'
import volume2Svg from '../assets/icons/feathericons/volume-2.svg?raw'
import filmSvg from '../assets/icons/feathericons/film.svg?raw'
import settingsSvg from '../assets/icons/feathericons/settings.svg?raw'
import logOutSvg from '../assets/icons/feathericons/log-out.svg?raw'
import messageCircleSvg from '../assets/icons/feathericons/message-circle.svg?raw'
import hashSvg from '../assets/icons/feathericons/hash.svg?raw'
import mailSvg from '../assets/icons/feathericons/mail.svg?raw'
import lockSvg from '../assets/icons/feathericons/lock.svg?raw'
import unlockSvg from '../assets/icons/feathericons/unlock.svg?raw'
import mapPinSvg from '../assets/icons/feathericons/map-pin.svg?raw'
import bookmarkSvg from '../assets/icons/feathericons/bookmark.svg?raw'
import sidebarSvg from '../assets/icons/feathericons/sidebar.svg?raw'
import layersSvg from '../assets/icons/feathericons/layers.svg?raw'
import xSvg from '../assets/icons/feathericons/x.svg?raw'
import percentSvg from '../assets/icons/feathericons/percent.svg?raw'
import externalLinkSvg from '../assets/icons/feathericons/external-link.svg?raw'
import eyeSvg from '../assets/icons/feathericons/eye.svg?raw'
import playSvg from '../assets/icons/feathericons/play.svg?raw'
import pauseSvg from '../assets/icons/feathericons/pause.svg?raw'

const ICONS: Record<string, string> = {
  'pie-chart': pieChartSvg,
  hash: hashSvg,
  'plus-square': plusSquareSvg,
  image: imageSvg,
  'volume-x': volumeXSvg,
  'volume-2': volume2Svg,
  film: filmSvg,
  settings: settingsSvg,
  'log-out': logOutSvg,
  'message-circle': messageCircleSvg,
  mail: mailSvg,
  lock: lockSvg,
  unlock: unlockSvg,
  'map-pin': mapPinSvg,
  bookmark: bookmarkSvg,
  sidebar: sidebarSvg,
  layers: layersSvg,
  x: xSvg,
  percent: percentSvg,
  'external-link': externalLinkSvg,
  eye: eyeSvg,
  play: playSvg,
  pause: pauseSvg,
}

export type IconName = keyof typeof ICONS

interface IconProps {
  name: IconName
  className?: string
  /** Size in pixels. Default 24. */
  size?: number
}

/** Themeable SVG icon (uses currentColor for stroke/fill). */
export function Icon({ name, className, size = 24 }: IconProps) {
  const svg = ICONS[name]
  if (!svg) return null
  return (
    <span
      className={`inline-flex shrink-0 text-current [&_svg]:w-full [&_svg]:h-full ${className ?? ''}`}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: svg }}
      aria-hidden
    />
  )
}
