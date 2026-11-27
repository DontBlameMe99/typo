import { DMSans_400Regular } from '@expo-google-fonts/dm-sans/400Regular'
import { DMSans_600SemiBold } from '@expo-google-fonts/dm-sans/600SemiBold'
import Constants, { ExecutionEnvironment } from 'expo-constants'
import { loadAsync as loadFontAssets } from 'expo-font'
import * as SplashScreen from 'expo-splash-screen'
import * as SystemUI from 'expo-system-ui'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, AppState, Linking, StatusBar, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { initialWindowMetrics, SafeAreaProvider } from 'react-native-safe-area-context'
import { resetDateFormatters } from '../core'
import {
  applyIntakeRoute,
  initialNativeIntent,
  parseNativeIntent,
  subscribeNativeIntents,
} from '../intake'
import { type IntakeRoute, parseDeepLink } from '../intake-parse'
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
  const [dateRevision, setDateRevision] = useState(0)
  const launched = loaded && ready && libraryReady
  const markLibraryReady = useCallback(() => setLibraryReady(true), [])
  const launchedRef = useRef(launched)
  launchedRef.current = launched
  const pendingRoutes = useRef<IntakeRoute[]>([])
  const intakeQueue = useRef(Promise.resolve())
  const initialIntakeRead = useRef(false)
  const handleRoute = useCallback((route: IntakeRoute) => {
    if (!launchedRef.current) {
      pendingRoutes.current.push(route)
      return
    }
    intakeQueue.current = intakeQueue.current
      .then(() => applyIntakeRoute(route))
      .catch((cause: unknown) => {
        const message = cause instanceof Error ? cause.message : String(cause)
        Alert.alert('Cannot open the shared item', message)
      })
  }, [])
  useEffect(() => {
    const urls = Linking.addEventListener('url', ({ url }) => {
      const route = parseDeepLink(url)
      if (route) handleRoute(route)
    })
    const intents = subscribeNativeIntents((intent) => {
      const route = parseNativeIntent(intent)
      if (route) handleRoute(route)
    })
    if (!initialIntakeRead.current) {
      initialIntakeRead.current = true
      void Promise.all([
        Linking.getInitialURL()
          .then((url) => (url ? parseDeepLink(url) : null))
          .catch(() => null),
        initialNativeIntent(),
      ]).then((routes) => {
        for (const route of routes) if (route) handleRoute(route)
      })
    }
    return () => {
      urls.remove()
      intents.remove()
    }
  }, [handleRoute])
  useEffect(() => {
    if (!launched || !pendingRoutes.current.length) return
    const routes = pendingRoutes.current.splice(0)
    for (const route of routes) handleRoute(route)
  }, [launched, handleRoute])
  useEffect(() => {
    // Activity recreation can preserve JS while the locale or time zone changes.
    const refresh = () => {
      resetDateFormatters()
      setDateRevision((value) => value + 1)
    }
    refresh()
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh()
    })
    return () => subscription.remove()
  }, [])
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
      {ready && loaded ? (
        <Library onReady={markLibraryReady} visible={launched} dateRevision={dateRevision} />
      ) : null}
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
