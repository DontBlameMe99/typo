import { File } from 'expo-file-system'
import * as FileSystem from 'expo-file-system/legacy'
import type { ReactNode } from 'react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useColorScheme } from 'react-native'
import { markStartup } from './startup'
import type { ThemeSettings } from './theme-data'
import { defaultThemeSettings, parseThemeSettings, resolveTheme } from './theme-data'

export * from './theme-data'

type ThemeContextValue = ReturnType<typeof resolveTheme> & {
  settings: ThemeSettings
  updateSettings: (patch: Partial<ThemeSettings>) => void
  ready: boolean
  persistenceError: string | null
}
const ThemeContext = createContext<ThemeContextValue | null>(null)
const path = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}typo-appearance.json`
  : null

// The file is small and local, so the first render reads it instead of waiting
// for an effect. That keeps the saved theme out of a second render pass.
function readTheme(): { settings: ThemeSettings; error: string | null } {
  try {
    if (!path) throw new Error('Appearance storage is unavailable.')
    const file = new File(path)
    if (!file.exists) return { settings: defaultThemeSettings, error: null }
    return { settings: parseThemeSettings(JSON.parse(file.textSync())), error: null }
  } catch {
    return {
      settings: defaultThemeSettings,
      error: 'Could not restore appearance. Choose your settings again to save them.',
    }
  }
}
const initialTheme = readTheme()
markStartup('theme')

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemDark = useColorScheme() === 'dark'
  const [settings, setSettings] = useState(initialTheme.settings)
  const [persistenceError, setPersistenceError] = useState<string | null>(initialTheme.error)
  const writes = useRef(Promise.resolve())

  const updateSettings = useCallback((patch: Partial<ThemeSettings>) => {
    setSettings((previous) => parseThemeSettings({ ...previous, ...patch }))
  }, [])

  useEffect(() => {
    let cancelled = false
    writes.current = writes.current.then(async () => {
      try {
        if (!path) throw new Error('Appearance storage is unavailable.')
        await FileSystem.writeAsStringAsync(path, JSON.stringify(settings))
        if (!cancelled) setPersistenceError(null)
      } catch {
        if (!cancelled)
          setPersistenceError(
            'Appearance could not be saved. Your selection still applies for this session.'
          )
      }
    })
    return () => {
      cancelled = true
    }
  }, [settings])

  const value = useMemo(
    () => ({
      ...resolveTheme(settings, systemDark),
      settings,
      updateSettings,
      ready: true,
      persistenceError,
    }),
    [settings, systemDark, updateSettings, persistenceError]
  )
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const value = useContext(ThemeContext)
  if (!value) throw new Error('useTheme must be used inside ThemeProvider.')
  return value
}
