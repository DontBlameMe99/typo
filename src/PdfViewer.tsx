import * as FileSystem from 'expo-file-system/legacy'
import { useEffect, useRef, useState } from 'react'
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Linking,
  type StyleProp,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native'
import { Circle, Path, Svg } from 'react-native-svg'
import { WebView } from 'react-native-webview'
import { hexToHsl, hslToHex, rgba } from './color'
import { inlineJson } from './editor/document'
import { ReportIssue } from './ReportIssue'
import { useTheme } from './theme'
import { afterPaint, webRuntime } from './web-runtime'
import { useWebViewForegroundReload } from './webview-resume'

const SPINNER_DELAY = 120
const MESSAGE_DELAY = 5000
const REPORT_DELAY = 10_000
const SPIN_MS = 900
// The headline squashes to a line and grows back one letter at a time. Each
// letter of the new line uses MORPH_SPAN of the morph, and the last one starts
// MORPH_LAG after the first, so the two add up to the whole value.
const MORPH_OUT_MS = 150
const MORPH_IN_MS = 320
const MORPH_SPAN = 0.6
const MORPH_LAG = 0.4
const LOADING_MESSAGES = [
  'Getting ready…',
  'Removing a Typo…',
  'Warming up…',
  'Setting the type…',
  'Compiling…',
  'Laying out pages…',
  'Measuring margins…',
  'Checking lines…',
  'Adding some polish…',
  'Almost there…',
]
const SLOW_MESSAGE = 'Still compiling…'
const LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:'])

function selectionColor(accent: string, dark: boolean): string {
  const hsl = hexToHsl(accent)
  const color = hslToHex({ h: hsl.h, s: hsl.s, l: Math.min(0.6, Math.max(0.4, hsl.l)) })
  return rgba(color, dark ? 0.5 : 0.34)
}

function openLink(url: string) {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]
  if (!scheme || !LINK_PROTOCOLS.has(`${scheme.toLowerCase()}:`)) return
  void Linking.openURL(url).catch(() => {})
}

type Props = {
  source: { uri: string } | null
  style?: StyleProp<ViewStyle>
  onError: (cause: Error) => void
}

export default function PdfViewer(props: Props) {
  const { colors, isDark, palette } = useTheme()
  const web = useRef<WebView<object>>(null)
  const latest = useRef(props)
  latest.current = props
  const [uri, setUri] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [displayed, setDisplayed] = useState<string | null>(null)
  const [session, setSession] = useState(0)
  const [waiting, setWaiting] = useState(false)
  const [message, setMessage] = useState(0)
  const [shown, setShown] = useState(LOADING_MESSAGES[0])
  const [elapsed, setElapsed] = useState(0)
  const [trouble, setTrouble] = useState(false)
  const spin = useRef(new Animated.Value(0)).current
  const fade = useRef(new Animated.Value(0)).current
  const shade = useRef(new Animated.Value(1)).current
  const morph = useRef(new Animated.Value(1)).current
  const growing = useRef(false)
  // Animated.timing has no reduce-motion switch of its own.
  const reducedMotion = useRef(false)
  const requested = useRef<string | null>(null)
  const theme = inlineJson({
    background: palette.crust,
    foreground: colors.ink,
    accent: colors.accent,
    surface: `${palette.surface0}E6`,
    selection: selectionColor(colors.accent, isDark),
  })
  const source = props.source?.uri ?? null
  const showing = !!source && displayed === source
  const loading = !showing && waiting

  useEffect(() => {
    let canceled = false
    const cancel = afterPaint(() => {
      void webRuntime('pdf')
        .then((path) => {
          if (!canceled) setUri(path)
        })
        .catch((cause: unknown) => {
          if (!canceled)
            latest.current.onError(
              cause instanceof Error ? cause : new Error('Cannot load the offline PDF viewer.')
            )
        })
    })
    return () => {
      cancel()
      canceled = true
    }
  }, [])
  useWebViewForegroundReload(() => {
    requested.current = null
    setReady(false)
    setDisplayed(null)
    setSession((value) => value + 1)
  }, !!uri)

  useEffect(() => {
    if (ready) return
    const timer = setTimeout(
      () => latest.current.onError(new Error('The offline PDF viewer took too long to start.')),
      30_000
    )
    return () => clearTimeout(timer)
  }, [ready])

  useEffect(() => {
    if (showing) {
      setWaiting(false)
      return
    }
    const timer = setTimeout(() => setWaiting(true), SPINNER_DELAY)
    return () => clearTimeout(timer)
  }, [showing])

  useEffect(() => {
    if (!loading) return
    morph.stopAnimation()
    morph.setValue(1)
    growing.current = false
    setShown(LOADING_MESSAGES[0])
    setMessage(0)
    setElapsed(0)
    setTrouble(false)
    const tick = setInterval(() => setElapsed((seconds) => seconds + 1), 1000)
    const rotation = setInterval(
      () => setMessage((index) => (index + 1) % LOADING_MESSAGES.length),
      MESSAGE_DELAY
    )
    const report = setTimeout(() => {
      clearInterval(rotation)
      setTrouble(true)
    }, REPORT_DELAY)
    return () => {
      clearInterval(tick)
      clearInterval(rotation)
      clearTimeout(report)
    }
  }, [loading, morph])

  useEffect(() => {
    if (!loading) return
    spin.setValue(0)
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: SPIN_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    )
    loop.start()
    return () => loop.stop()
  }, [loading, spin])

  useEffect(() => {
    let alive = true
    void AccessibilityInfo.isReduceMotionEnabled().then((on) => {
      if (alive) reducedMotion.current = on
    })
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (on) => {
      reducedMotion.current = on
    })
    return () => {
      alive = false
      subscription.remove()
    }
  }, [])

  useEffect(() => {
    if (!trouble) {
      fade.setValue(0)
      return
    }
    Animated.timing(fade, { toValue: 1, duration: 200, useNativeDriver: true }).start()
  }, [trouble, fade])

  // The finished page dissolves out of the crust under the spinner, so a short
  // compile lands as softly as a long one. The shade covers instantly, and only
  // a page that has rendered fades in.
  useEffect(() => {
    Animated.timing(shade, {
      toValue: showing ? 0 : 1,
      duration: showing && !reducedMotion.current ? 180 : 0,
      useNativeDriver: true,
    }).start()
  }, [shade, showing])

  // The headline swaps every few seconds while compiling: the old line squashes
  // flat, the text swaps, and the new line grows back letter by letter.
  const headlineText = trouble ? SLOW_MESSAGE : LOADING_MESSAGES[message]
  const squashing = shown !== headlineText
  const wave = shown.length > 1 ? MORPH_LAG / (shown.length - 1) : 0
  const chars = Array.from(shown, (char, index) => ({
    slot: index,
    char,
    from: squashing ? 0 : index * wave,
    span: squashing ? 1 : MORPH_SPAN,
  }))
  useEffect(() => {
    if (shown !== headlineText) {
      if (reducedMotion.current) {
        growing.current = false
        morph.stopAnimation()
        morph.setValue(1)
        setShown(headlineText)
        return
      }
      growing.current = true
      Animated.timing(morph, {
        toValue: 0,
        duration: MORPH_OUT_MS,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setShown(headlineText)
      })
      return
    }
    // The grow waits for the new letters, so it never animates the old line.
    if (!growing.current) return
    growing.current = false
    if (reducedMotion.current) {
      morph.setValue(1)
      return
    }
    Animated.timing(morph, {
      toValue: 1,
      duration: MORPH_IN_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start()
  }, [headlineText, morph, shown])

  useEffect(() => {
    if (!ready || !source || showing) return
    const timer = setTimeout(
      () =>
        latest.current.onError(
          new Error('The PDF viewer did not display any pages. Try reopening the PDF.')
        ),
      60_000
    )
    return () => clearTimeout(timer)
  }, [ready, source, showing])

  useEffect(() => {
    if (ready) web.current?.injectJavaScript(`window.typoPdf?.theme(${theme});true;`)
  }, [ready, theme])

  useEffect(() => {
    if (!ready || !source || requested.current === source) return
    requested.current = source
    setDisplayed(null)
    web.current?.injectJavaScript(`window.typoPdf?.load(${inlineJson(source)});true;`)
  }, [ready, source])

  return (
    <View style={[{ flex: 1 }, props.style, { backgroundColor: palette.crust }]}>
      {uri && (
        <WebView<object>
          key={session}
          ref={web}
          source={{ uri }}
          style={{ flex: 1, backgroundColor: palette.crust, opacity: source && !showing ? 0 : 1 }}
          originWhitelist={['file://*']}
          allowFileAccess
          allowFileAccessFromFileURLs
          allowingReadAccessToURL={FileSystem.cacheDirectory ?? undefined}
          javaScriptEnabled
          setBuiltInZoomControls={false}
          setDisplayZoomControls={false}
          domStorageEnabled={false}
          setSupportMultipleWindows={false}
          onShouldStartLoadWithRequest={(request) =>
            request.url === uri || request.url === 'about:blank'
          }
          onLoadStart={() => {
            setReady(false)
          }}
          onError={() => props.onError(new Error('The offline PDF viewer could not load.'))}
          onRenderProcessGone={() =>
            props.onError(new Error('The PDF viewer stopped. Try reopening the PDF.'))
          }
          onContentProcessDidTerminate={() =>
            props.onError(new Error('The PDF viewer stopped. Try reopening the PDF.'))
          }
          onMessage={(event) => {
            try {
              const message = JSON.parse(event.nativeEvent.data)
              if (message.type === 'boot') {
                const target = latest.current.source?.uri ?? null
                requested.current = target
                setDisplayed(null)
                if (target)
                  web.current?.injectJavaScript(
                    `window.typoPdf.theme(${theme});window.typoPdf.load(${inlineJson(target)});true;`
                  )
                setReady(true)
              } else if (
                message.type === 'rendered' &&
                message.uri === (latest.current.source?.uri ?? requested.current)
              )
                setDisplayed(message.uri)
              else if (message.type === 'link' && typeof message.url === 'string')
                openLink(message.url)
              else if (message.type === 'error' && typeof message.message === 'string')
                latest.current.onError(new Error(message.message))
            } catch {
              latest.current.onError(new Error('The PDF viewer sent an invalid response.'))
            }
          }}
        />
      )}
      <Animated.View
        pointerEvents="none"
        style={[s.loading, { backgroundColor: palette.crust, opacity: shade }]}
      />
      {loading && (
        <View style={[s.loading, { backgroundColor: palette.crust }]}>
          <View
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel="Compiling the PDF"
            style={s.status}
          >
            <Animated.View
              style={{
                transform: [
                  {
                    rotate: spin.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0deg', '360deg'],
                    }),
                  },
                ],
              }}
            >
              <Svg width={56} height={56} viewBox="0 0 30 30">
                <Circle cx={15} cy={15} r={11} fill="none" stroke={colors.line} strokeWidth={3} />
                <Path
                  d="M15 4a11 11 0 0 1 11 11"
                  fill="none"
                  stroke={colors.accent}
                  strokeWidth={3}
                  strokeLinecap="round"
                />
              </Svg>
            </Animated.View>
            <View style={s.headlineRow}>
              {chars.map(({ slot, char, from, span }) => {
                const range = [from, from + span]
                return (
                  <Animated.Text
                    key={slot}
                    style={[
                      s.headline,
                      { color: colors.ink },
                      {
                        opacity: morph.interpolate({
                          inputRange: range,
                          outputRange: [0, 1],
                          extrapolate: 'clamp',
                        }),
                        transform: [
                          {
                            scaleY: morph.interpolate({
                              inputRange: range,
                              outputRange: [0.08, 1],
                              extrapolate: 'clamp',
                            }),
                          },
                          {
                            scaleX: morph.interpolate({
                              inputRange: range,
                              outputRange: [1.35, 1],
                              extrapolate: 'clamp',
                            }),
                          },
                        ],
                      },
                    ]}
                  >
                    {char}
                  </Animated.Text>
                )
              })}
            </View>
            {elapsed > 0 && (
              <Text style={[s.seconds, { color: colors.muted }]}>
                {`${elapsed} ${elapsed === 1 ? 'second' : 'seconds'} so far`}
              </Text>
            )}
          </View>
          {trouble && (
            <Animated.View style={[s.reportShell, { opacity: fade }]}>
              <View style={[s.report, { backgroundColor: palette.mantle }]}>
                <View style={[s.reportLine, { backgroundColor: colors.line }]} />
                <ReportIssue />
              </View>
            </Animated.View>
          )}
        </View>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  loading: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  status: {
    alignItems: 'center',
    paddingHorizontal: 36,
  },
  headlineRow: {
    marginTop: 22,
    flexDirection: 'row',
    // Large system text wraps the line instead of running past the screen.
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  headline: {
    fontFamily: 'DMSans_600SemiBold',
    fontSize: 24,
    letterSpacing: -0.5,
  },
  seconds: {
    marginTop: 4,
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
  },
  reportShell: {
    position: 'absolute',
    left: 20,
    right: 20,
    // Clears the content fade above the dock, which is painted over this area.
    bottom: 48,
  },
  report: {
    borderRadius: 24,
    overflow: 'hidden',
  },
  reportLine: {
    height: 1,
    marginHorizontal: 16,
  },
})
