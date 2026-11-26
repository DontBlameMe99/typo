import type { ReactNode } from 'react'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useColorScheme } from 'react-native'
import type { ThemeSettings } from './theme-data'
import { parseThemeSettings, resolveTheme } from './theme-data'
import { readTheme, saveError, writeTheme } from './theme-storage'

export * from './theme-data'

type ThemeContextValue = ReturnType<typeof resolveTheme> & {
  settings: ThemeSettings
  updateSettings: (patch: Partial<ThemeSettings>) => void
  ready: boolean
  persistenceError: string | null
}
const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemDark = useColorScheme() === 'dark'
  // The file is small and local, so the first render reads it instead of waiting
  // for an effect. That keeps the saved theme out of a second render pass.
  // Read on each mount: the quick note sheet shares the runtime and must start
  // from the appearance the main app may have saved since startup.
  const [initialTheme] = useState(readTheme)
  const [settings, setSettings] = useState(initialTheme.settings)
  const [persistenceError, setPersistenceError] = useState<string | null>(initialTheme.error)

  const updateSettings = useCallback((patch: Partial<ThemeSettings>) => {
    setSettings((previous) => parseThemeSettings({ ...previous, ...patch }))
  }, [])

  useEffect(() => {
    let cancelled = false
    void writeTheme(settings).then(
      () => {
        if (!cancelled) setPersistenceError(null)
      },
      () => {
        if (!cancelled) setPersistenceError(saveError)
      }
    )
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
