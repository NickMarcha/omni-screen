import { useState, useEffect, memo } from 'react'

interface ImageEmbedProps {
  url: string
  alt?: string
  className?: string
}

function ImageEmbed({ 
  url, 
  alt = 'Image',
  className = 'w-full max-h-[70vh] object-contain rounded-lg mb-4'
}: ImageEmbedProps) {
  const [imageSrc, setImageSrc] = useState<string>(url)
  const [hasError, setHasError] = useState(false)
  const [isLoadingProxy, setIsLoadingProxy] = useState(false)

  // Reset state when URL changes
  useEffect(() => {
    setImageSrc(url)
    setHasError(false)
    setIsLoadingProxy(false)
  }, [url])

  const handleError = async (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    const target = e.target as HTMLImageElement
    
    // If we've already tried the proxy or are currently loading it, hide the image
    if (isLoadingProxy || imageSrc.startsWith('data:')) {
      target.style.display = 'none'
      setHasError(true)
      return
    }

    // Check if this might be a CORS issue (4cdn.org, imgur, etc.)
    const isLikelyCorsIssue = url.includes('4cdn.org') || 
                              url.includes('imgur.com') || 
                              url.includes('twimg.com') ||
                              url.includes('i.4cdn.org')

    if (isLikelyCorsIssue && typeof window !== 'undefined' && window.ipcRenderer) {
      // Try to fetch via proxy
      setIsLoadingProxy(true)
      try {
        const result = await window.ipcRenderer.invoke('fetch-image', url)
        if (result.success && result.dataUrl) {
          setImageSrc(result.dataUrl)
          setIsLoadingProxy(false)
          // Don't hide - let it retry with the data URL
          return
        }
      } catch (error) {
        console.error('Failed to fetch image via proxy:', error)
      }
      setIsLoadingProxy(false)
    }

    // If proxy failed or not applicable, hide the image
    target.style.display = 'none'
    setHasError(true)
  }

  if (hasError && !isLoadingProxy) {
    return null
  }

  return (
    <img
      src={imageSrc}
      alt={alt}
      className={className}
      onError={handleError}
    />
  )
}

export default memo(ImageEmbed, (prevProps, nextProps) => {
  return (
    prevProps.url === nextProps.url &&
    prevProps.alt === nextProps.alt &&
    prevProps.className === nextProps.className
  )
})
