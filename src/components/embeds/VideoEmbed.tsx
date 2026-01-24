interface VideoEmbedProps {
  url: string
  autoplay?: boolean
  muted?: boolean
  controls?: boolean
  className?: string
}

export default function VideoEmbed({ 
  url, 
  autoplay = false, 
  muted = false, 
  controls = true,
  className = 'w-full max-h-[70vh] rounded-lg mb-4'
}: VideoEmbedProps) {
  return (
    <video
      src={url}
      className={className}
      controls={controls}
      autoPlay={autoplay}
      muted={muted}
      loop
      playsInline
      onError={(e) => {
        const target = e.target as HTMLVideoElement
        target.style.display = 'none'
      }}
    />
  )
}
