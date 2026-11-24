import { useEffect, useRef, useState } from 'react'
import type { StyleProp, TextStyle } from 'react-native'
import { Pressable, Text, useWindowDimensions, View } from 'react-native'
import Reanimated, {
  Easing,
  type EasingFunction,
  type EasingFunctionFactory,
  Extrapolation,
  interpolate,
  interpolateColor,
  ReduceMotion,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { Icon, type IconName } from '../icons'
import { useStyles } from './styles'

export const SLIDE_TIMING = { duration: 250, easing: Easing.bezier(0.22, 1, 0.36, 1) }
const ICON_SWAP_TIMING = { duration: 250, easing: Easing.bezier(0.42, 0, 0.58, 1) }

type MotionCallback = (finished?: boolean) => void

export function spring(
  toValue: number,
  config: { damping: number; mass: number; overshootClamping: boolean; stiffness: number },
  callback?: MotionCallback
): number {
  'worklet'
  return withSpring(toValue, { ...config, reduceMotion: ReduceMotion.System }, callback)
}

export function timing(
  toValue: number,
  config: { duration: number; easing?: EasingFunction | EasingFunctionFactory },
  callback?: MotionCallback
): number {
  'worklet'
  return withTiming(toValue, { ...config, reduceMotion: ReduceMotion.System }, callback)
}

export function Fade({ id, color, mid = 0.6 }: { id: string; color: string; mid?: number }) {
  return (
    <Svg width="100%" height="100%">
      <Defs>
        <LinearGradient id={id} x1="0" y1="1" x2="0" y2="0">
          <Stop offset="0" stopColor={color} stopOpacity={1} />
          <Stop offset={`${mid}`} stopColor={color} stopOpacity={1} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Rect width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  )
}

export function SwapIcon({
  from,
  to,
  active,
  size = 22,
  color,
  fromFill,
  toFill,
  activeScale = 1.1,
}: {
  from: IconName
  to: IconName
  active: boolean
  size?: number
  color?: string
  fromFill?: string
  toFill?: string
  activeScale?: number
}) {
  const s = useStyles()
  const progress = useSharedValue(active ? 1 : 0)
  useEffect(() => {
    progress.value = spring(active ? 1 : 0, {
      damping: 13,
      mass: 0.5,
      stiffness: 240,
      overshootClamping: false,
    })
  }, [active, progress])
  const outgoing = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [1, 0], Extrapolation.CLAMP),
    transform: [
      { scale: interpolate(progress.value, [0, 1], [1, 0.55], Extrapolation.CLAMP) },
      { rotate: `${interpolate(progress.value, [0, 1], [0, -20], Extrapolation.CLAMP)}deg` },
    ],
  }))
  const incoming = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [0, 1], Extrapolation.CLAMP),
    transform: [
      { scale: interpolate(progress.value, [0, 1], [0.55, activeScale]) },
      { rotate: `${interpolate(progress.value, [0, 1], [20, 0], Extrapolation.CLAMP)}deg` },
    ],
  }))
  return (
    <View style={{ width: size, height: size }}>
      <Reanimated.View style={[s.swapIconLayer, outgoing]}>
        <Icon name={from} size={size} color={color} fill={fromFill} />
      </Reanimated.View>
      <Reanimated.View style={[s.swapIconLayer, incoming]}>
        <Icon name={to} size={size} color={color} fill={toFill} />
      </Reanimated.View>
    </View>
  )
}

// One face shrinks away while the other settles in, so a control that swaps
// what it shows keeps its frame.
export function SwapFaces({
  front,
  back,
  swapped,
  size,
}: {
  front: React.ReactNode
  back: React.ReactNode
  swapped: boolean
  size: number
}) {
  const s = useStyles()
  const progress = useSharedValue(swapped ? 1 : 0)
  useEffect(() => {
    progress.value = timing(swapped ? 1 : 0, ICON_SWAP_TIMING)
  }, [progress, swapped])
  const outgoing = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [1, 0], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(progress.value, [0, 1], [1, 0.25], Extrapolation.CLAMP) }],
  }))
  const incoming = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [0, 1], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(progress.value, [0, 1], [0.25, 1], Extrapolation.CLAMP) }],
  }))
  return (
    <View style={{ width: size, height: size }}>
      <Reanimated.View style={[s.swapIconLayer, outgoing]}>{front}</Reanimated.View>
      <Reanimated.View style={[s.swapIconLayer, incoming]}>{back}</Reanimated.View>
    </View>
  )
}

export function IconFade({
  from,
  to,
  swapped,
  size,
  color,
}: {
  from: IconName
  to: IconName
  swapped: boolean
  size: number
  color: string
}) {
  return (
    <SwapFaces
      swapped={swapped}
      size={size}
      front={<Icon name={from} size={size} color={color} />}
      back={<Icon name={to} size={size} color={color} />}
    />
  )
}

// A counter that ticks like an odometer: every digit is its own column, so only
// the digits that changed roll, and the rest hold still.
const TICKER_LINE = 16

export function Ticker({
  current,
  total,
  style,
}: {
  current: number
  total: number
  style?: StyleProp<TextStyle>
}) {
  const s = useStyles()
  const { fontScale } = useWindowDimensions()
  // The slot follows the scaled line box, so enlarged digits are not clipped.
  const slot = Math.round(TICKER_LINE * fontScale)
  const text: StyleProp<TextStyle> = [style, { lineHeight: slot }]
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
      accessibilityLabel={`${current}/${total}`}
      style={s.ticker}
    >
      <TickerNumber value={current} slot={slot} style={text} />
      <Text style={text}>/</Text>
      <TickerNumber value={total} slot={slot} style={text} />
    </View>
  )
}

function TickerNumber({
  value,
  slot,
  style,
}: {
  value: number
  slot: number
  style?: StyleProp<TextStyle>
}) {
  const s = useStyles()
  const digits = [...String(value)].map((digit, at, all) => ({
    digit,
    // A digit's place is its identity: 11 to 12 keeps the tens column as it is.
    place: all.length - at,
  }))
  return (
    <View style={s.tickerDigits}>
      {digits.map((column) => (
        <TickerDigit key={column.place} digit={column.digit} slot={slot} style={style} />
      ))}
    </View>
  )
}

function TickerDigit({
  digit,
  slot,
  style,
}: {
  digit: string
  slot: number
  style?: StyleProp<TextStyle>
}) {
  const s = useStyles()
  const [shown, setShown] = useState(digit)
  const [previous, setPrevious] = useState<string | null>(null)
  const roll = useSharedValue(1)
  useEffect(() => {
    if (digit === shown) return
    setPrevious(shown)
    setShown(digit)
    roll.value = 0
    roll.value = timing(1, { duration: 200 })
  }, [digit, roll, shown])
  const incoming = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - roll.value) * slot }],
  }))
  const outgoing = useAnimatedStyle(() => ({
    opacity: 1 - roll.value,
    transform: [{ translateY: -roll.value * slot }],
  }))
  return (
    <View style={[s.tickerDigit, { height: slot }]}>
      <Text style={[style, s.tickerSizer]}>0</Text>
      {previous === null ? null : (
        <Reanimated.Text style={[style, s.tickerGlyph, outgoing]}>{previous}</Reanimated.Text>
      )}
      <Reanimated.Text style={[style, s.tickerGlyph, incoming]}>{shown}</Reanimated.Text>
    </View>
  )
}

export function PillTabs<T extends string>({
  options,
  value,
  onSelect,
  style,
  itemStyle,
  textStyle,
  maxFontSizeMultiplier,
  pillStyle,
  inset,
  activeColor,
  idleColor,
}: {
  options: readonly { value: T; label: string }[]
  value: T
  onSelect: (value: T) => void
  style?: React.ComponentProps<typeof View>['style']
  itemStyle?: React.ComponentProps<typeof View>['style']
  textStyle?: React.ComponentProps<typeof Text>['style']
  maxFontSizeMultiplier?: number
  pillStyle: React.ComponentProps<typeof View>['style']
  inset: number
  activeColor: string
  idleColor: string
}) {
  const [boxes, setBoxes] = useState<{ x: number; width: number }[]>([])
  const selected = Math.max(
    0,
    options.findIndex((option) => option.value === value)
  )
  const measured = options.every((_, at) => !!boxes[at])
  // Snapping the first placement keeps the pill from growing out of the corner.
  const placed = useRef(false)
  const position = useSharedValue(selected)
  const left = useSharedValue(0)
  const width = useSharedValue(0)
  useEffect(() => {
    position.value = timing(selected, SLIDE_TIMING)
  }, [position, selected])
  useEffect(() => {
    const box = boxes[selected]
    if (!box) return
    if (!placed.current) {
      placed.current = true
      left.value = box.x
      width.value = box.width
      return
    }
    left.value = timing(box.x, SLIDE_TIMING)
    width.value = timing(box.width, SLIDE_TIMING)
  }, [boxes, left, selected, width])
  const pill = useAnimatedStyle(
    () => ({
      width: width.value,
      transform: [{ translateX: left.value }],
      opacity: withTiming(measured ? 1 : 0, {
        duration: 150,
        reduceMotion: ReduceMotion.System,
      }),
    }),
    [measured]
  )
  return (
    <View style={style}>
      <Reanimated.View
        style={[{ position: 'absolute', left: 0, top: inset, bottom: inset }, pillStyle, pill]}
      />
      {options.map((option, at) => (
        <Pressable
          key={option.value}
          accessibilityRole="tab"
          accessibilityState={{ selected: option.value === value }}
          onPress={() => onSelect(option.value)}
          onLayout={(event) => {
            const { x, width } = event.nativeEvent.layout
            setBoxes((current) => {
              if (current[at]?.x === x && current[at]?.width === width) return current
              const copy = current.slice()
              copy[at] = { x, width }
              return copy
            })
          }}
          style={itemStyle}
        >
          <PillLabel
            position={position}
            at={at}
            activeColor={activeColor}
            idleColor={idleColor}
            style={textStyle}
            maxFontSizeMultiplier={maxFontSizeMultiplier}
          >
            {option.label}
          </PillLabel>
        </Pressable>
      ))}
    </View>
  )
}

function PillLabel({
  position,
  at,
  activeColor,
  idleColor,
  style,
  maxFontSizeMultiplier,
  children,
}: {
  position: SharedValue<number>
  at: number
  activeColor: string
  idleColor: string
  style?: React.ComponentProps<typeof Text>['style']
  maxFontSizeMultiplier?: number
  children: React.ReactNode
}) {
  const color = useAnimatedStyle(() => ({
    color: interpolateColor(Math.abs(position.value - at), [0, 1], [activeColor, idleColor]),
  }))
  return (
    <Reanimated.Text maxFontSizeMultiplier={maxFontSizeMultiplier} style={[style, color]}>
      {children}
    </Reanimated.Text>
  )
}
