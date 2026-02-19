export function FindYoutubeVideoIdFromParagraph(paragraph: string): string | null {
  if (paragraph == null) return null
  const regExp = /^.*(youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/
  for (const s of paragraph.split(' ')) {
    const m = s.match(regExp)
    if (m && m[2]?.length === 11) return m[2]
  }
  return null
}

export function RenderClickableMessage({ message }: { message: string }) {
  if (message == null) return <></>
  const urlRegex = /(https?:\/\/[^\s]+)/g
  const parts = message.split(/((?:https?:\/\/|www)[^\s]+)/g)
  return (
    <>
      {parts.map((part, i) =>
        part.match(urlRegex) ? (
          <a key={i} className="link link-primary" href={part.startsWith('http') ? part : `https://${part}`} target="_blank" rel="noopener noreferrer">
            {part}
          </a>
        ) : (
          part
        )
      )}
    </>
  )
}

export async function sendToClip(str: string): Promise<void> {
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(str)
  } else {
    const ta = document.createElement('textarea')
    ta.value = str
    ta.style.position = 'fixed'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }
}

export function fromSerialDate(serialDate: number): string {
  const epoch = new Date(1899, 11, 30)
  const date = new Date(epoch.getTime() + serialDate * 24 * 60 * 60 * 1000)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear() % 100}`
}

const flagLookup: Record<string, string> = {
  england: 'https://flagcdn.com/48x36/gb-eng.png',
  wales: 'https://flagcdn.com/48x36/gb-wls.png',
  scotland: 'https://flagcdn.com/48x36/gb-sct.png',
  ww: 'https://i.imgur.com/vJXGYCI.png',
}

export function getFlagUrl(flagCode: string): string {
  return flagLookup[flagCode.toLowerCase()] ?? `https://flagcdn.com/48x36/${flagCode}.png`
}
