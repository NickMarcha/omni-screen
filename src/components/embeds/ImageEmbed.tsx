interface ImageEmbedProps {
  url: string
  alt?: string
  className?: string
}

export default function ImageEmbed({ 
  url, 
  alt = 'Image',
  className = 'w-full max-h-[70vh] object-contain rounded-lg mb-4'
}: ImageEmbedProps) {
  return (
    <img
      src={url}
      alt={alt}
      className={className}
      onError={(e) => {
        const target = e.target as HTMLImageElement
        target.style.display = 'none'
      }}
    />
  )
}
