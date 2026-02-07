import { memo } from 'react'

interface VideoEmbedProps {
  url: string
  autoplay?: boolean
  muted?: boolean
  controls?: boolean
  className?: string
  /** When set, loop is disabled so the video can end and fire onEnded. */
  onEnded?: () => void
}

function VideoEmbed({ 
  url, 
  autoplay = false, 
  muted = false, 
  controls = true,
  className = 'w-full max-h-[70vh] rounded-lg mb-4',
  onEnded,
}: VideoEmbedProps) {
  return (
    <video
      src={url}
      className={className}
      controls={controls}
      autoPlay={autoplay}
      muted={muted}
      loop={onEnded == null}
      playsInline
      onEnded={onEnded}
      onError={(e) => {
        const target = e.target as HTMLVideoElement
        target.style.display = 'none'
      }}
    />
  )
}

export default memo(VideoEmbed, (prevProps, nextProps) => {
  return (
    prevProps.url === nextProps.url &&
    prevProps.autoplay === nextProps.autoplay &&
    prevProps.muted === nextProps.muted &&
    prevProps.controls === nextProps.controls &&
    prevProps.className === nextProps.className &&
    prevProps.onEnded === nextProps.onEnded
  )
})
