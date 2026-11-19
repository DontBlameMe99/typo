import { DMSans_400Regular } from '@expo-google-fonts/dm-sans/400Regular'
import { DMSans_600SemiBold } from '@expo-google-fonts/dm-sans/600SemiBold'
import Constants, { ExecutionEnvironment } from 'expo-constants'
import { loadAsync as loadFontAssets } from 'expo-font'
import * as SplashScreen from 'expo-splash-screen'
import * as SystemUI from 'expo-system-ui'
import { useCallback, useEffect, useState } from 'react'
import { StatusBar, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { initialWindowMetrics, SafeAreaProvider } from 'react-native-safe-area-context'
import { TypoMark } from '../Mark'
import { markStartup } from '../startup'
import { ThemeProvider, useTheme } from '../theme'
import { Library } from './Library'
import { useStyles } from './styles'
import { DialogHost } from './ui'

const fonts = {
  DMSans_400Regular,
  DMSans_600SemiBold,
  JetBrainsMono_400Regular: require('../../assets/fonts/JetBrainsMono-Regular.ttf'),
}
// Fonts are files, so start them while the rest of the module graph evaluates.
const fontLoad = loadFontAssets(fonts).catch(() => {})
// JS startup baseline for the first library frame, which pairs with the native splash.
const appStartedAt = performance.now()
// The splash hides itself when the first content frame appears, so it never
// waits on a frame that needs the theme or the fonts. Expo Go owns its own
// splash, so only real native builds can set the exit duration.
if (Constants.executionEnvironment !== ExecutionEnvironment.StoreClient) {
  SplashScreen.setOptions({ duration: 0 })
}

export default function App() {
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    let cancelled = false
    const settle = () => {
      if (cancelled) return
      markStartup('fonts')
      setLoaded(true)
    }
    void fontLoad.then(settle, settle)
    return () => {
      cancelled = true
    }
  }, [])
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <SafeAreaProvider initialMetrics={initialWindowMetrics}>
          <AppShell loaded={loaded} />
        </SafeAreaProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  )
}

function AppShell({ loaded }: { loaded: boolean }) {
  const { colors, isDark, ready } = useTheme()
  const [libraryReady, setLibraryReady] = useState(false)
  const launched = loaded && ready && libraryReady
  const markLibraryReady = useCallback(() => setLibraryReady(true), [])
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors.paper).catch(() => {})
  }, [colors.paper])
  useEffect(() => {
    if (launched && __DEV__)
      console.info(
        `[performance] First library frame: ${Math.round(performance.now() - appStartedAt)} ms`
      )
  }, [launched])
  return (
    <DialogHost>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      {/*
        The library loads behind the launch screen, so its first frame is a painted list. It
        waits for the fonts because text measured without them stays wrapped once they load.
      */}
      {ready && loaded ? <Library onReady={markLibraryReady} visible={launched} /> : null}
      {!launched && <LaunchScreen overlay />}
    </DialogHost>
  )
}

function LaunchScreen({ overlay = false }: { overlay?: boolean }) {
  const s = useStyles()
  return (
    <View style={overlay ? [s.launchScreen, s.launchOverlay] : s.launchScreen}>
      <TypoMark size={120} />
    </View>
  )
}
