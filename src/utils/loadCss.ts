/** Load CSS via fetch with cache: 'no-store' and inject as style tag. Used for emotes/flairs so they are never cached.
 * Fetches first, then swaps: avoids flash from removing old CSS before new one is ready. */
export async function loadCSSNoCache(href: string, id: string): Promise<void> {
  const res = await fetch(href, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Failed to load CSS: ${res.status}`)
  const css = await res.text()
  const existing = document.getElementById(id)
  if (existing) existing.remove()
  const style = document.createElement('style')
  style.id = id
  style.textContent = css
  document.head.appendChild(style)
}
