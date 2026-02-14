import pieChartSvg from '../assets/icons/pie-chart.svg?raw'
import plusSquareSvg from '../assets/icons/plus-square.svg?raw'
import imageSvg from '../assets/icons/image.svg?raw'
import volumeXSvg from '../assets/icons/volume-x.svg?raw'
import volume2Svg from '../assets/icons/volume-2.svg?raw'
import filmSvg from '../assets/icons/film.svg?raw'
import settingsSvg from '../assets/icons/settings.svg?raw'
import logOutSvg from '../assets/icons/log-out.svg?raw'
import messageCircleSvg from '../assets/icons/message-circle.svg?raw'
import hashSvg from '../assets/icons/hash.svg?raw'
import mailSvg from '../assets/icons/mail.svg?raw'
import lockSvg from '../assets/icons/lock.svg?raw'
import unlockSvg from '../assets/icons/unlock.svg?raw'
import mapPinSvg from '../assets/icons/map-pin.svg?raw'
import bookmarkSvg from '../assets/icons/bookmark.svg?raw'
import sidebarSvg from '../assets/icons/sidebar.svg?raw'
import layersSvg from '../assets/icons/layers.svg?raw'
import xSvg from '../assets/icons/x.svg?raw'
import percentSvg from '../assets/icons/percent.svg?raw'

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
