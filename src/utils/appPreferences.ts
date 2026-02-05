export type ThemeMode = 'system' | 'light' | 'dark'
export type LightTheme =
  | 'light'
  | 'cupcake'
  | 'bumblebee'
  | 'emerald'
  | 'corporate'
  | 'retro'
  | 'cyberpunk'
  | 'valentine'
  | 'garden'
  | 'lofi'
  | 'pastel'
  | 'fantasy'
  | 'wireframe'
  | 'cmyk'
  | 'autumn'
  | 'acid'
  | 'lemonade'
  | 'winter'
  | 'nord'
  | 'caramellatte'
  | 'silk'
export type DarkTheme =
  | 'dark'
  | 'synthwave'
  | 'halloween'
  | 'forest'
  | 'aqua'
  | 'black'
  | 'luxury'
  | 'dracula'
  | 'business'
  | 'acid'
  | 'night'
  | 'coffee'
  | 'dim'
  | 'sunset'
  | 'abyss'

export type EmbedThemeMode = 'follow' | 'light' | 'dark'

export interface ThemeSettings {
  mode: ThemeMode
  lightTheme: LightTheme
  darkTheme: DarkTheme
  embedTheme: EmbedThemeMode
}

export interface UserscriptSettings {
  kickstiny: boolean
}

export interface AppPreferences {
  theme: ThemeSettings
  userscripts: UserscriptSettings
}

const STORAGE_KEY = 'omni-screen:app-preferences'

export const lightThemes: LightTheme[] = [
  'light',
  'cupcake',
  'bumblebee',
  'emerald',
  'corporate',
  'retro',
  'cyberpunk',
  'valentine',
  'garden',
  'lofi',
  'pastel',
  'fantasy',
  'wireframe',
  'cmyk',
  'autumn',
  'acid',
  'lemonade',
  'winter',
  'nord',
  'caramellatte',
  'silk',
]

export const darkThemes: DarkTheme[] = [
  'dark',
  'synthwave',
  'halloween',
  'forest',
  'aqua',
  'black',
  'luxury',
  'dracula',
  'business',
  'acid',
  'night',
  'coffee',
  'dim',
  'sunset',
  'abyss',
]

export const defaultPreferences: AppPreferences = {
  theme: { mode: 'system', lightTheme: 'retro', darkTheme: 'business', embedTheme: 'follow' },
  userscripts: { kickstiny: true },
}

export function getAppPreferences(): AppPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultPreferences
    const parsed = JSON.parse(raw)
    return {
      theme: {
        mode: parsed?.theme?.mode || defaultPreferences.theme.mode,
        lightTheme: parsed?.theme?.lightTheme || defaultPreferences.theme.lightTheme,
        darkTheme: parsed?.theme?.darkTheme || defaultPreferences.theme.darkTheme,
        embedTheme: parsed?.theme?.embedTheme || defaultPreferences.theme.embedTheme,
      },
      userscripts: {
        kickstiny:
          typeof parsed?.userscripts?.kickstiny === 'boolean'
            ? parsed.userscripts.kickstiny
            : defaultPreferences.userscripts.kickstiny,
      },
    }
  } catch {
    return defaultPreferences
  }
}

export function setAppPreferences(next: AppPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // ignore
  }
}

export function applyThemeToDocument(themeSettings: ThemeSettings): void {
  const html = document.documentElement
  const body = document.body

  let themeToApply: string
  if (themeSettings.mode === 'system') {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    themeToApply = mediaQuery.matches ? themeSettings.darkTheme : themeSettings.lightTheme
  } else if (themeSettings.mode === 'light') {
    themeToApply = themeSettings.lightTheme
  } else {
    themeToApply = themeSettings.darkTheme
  }

  html.setAttribute('data-theme', themeToApply)
  body.setAttribute('data-theme', themeToApply)

  const rootDiv = document.getElementById('root')
  if (rootDiv) rootDiv.setAttribute('data-theme', themeToApply)
}

