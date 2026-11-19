import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { StyleProp, ViewStyle } from 'react-native'
import {
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Reanimated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Icon, type IconName } from '../icons'
import { useTheme } from '../theme'
import { spring, timing } from './motion'
import { keyboardBehavior, SWIPE_SPRING } from './shared'
import { useStyles } from './styles'

const SHEET_SPRING = { damping: 34, mass: 0.8, overshootClamping: true, stiffness: 340 }
// Sheets rise into place with a short travel, a fade, and a touch of blur.
const SHEET_REVEAL_EASE = Easing.bezier(0.22, 1, 0.36, 1)
const SHEET_OPEN_DURATION = 400
const SHEET_CLOSE_DURATION = 350
const SHEET_REVEAL_TRAVEL = 160
const SHEET_REVEAL_BLUR = 2
const SCREEN_SPRING = { damping: 34, mass: 0.82, overshootClamping: true, stiffness: 320 }

const SCREEN_EDGE_WIDTH = 22

const backEdgeStyle = {
  position: 'absolute' as const,
  top: 0,
  bottom: 0,
  left: 0,
  width: SCREEN_EDGE_WIDTH,
  zIndex: 10,
}

export function IconButton({
  name,
  label,
  onPress,
  disabled = false,
}: {
  name: IconName
  label: string
  onPress: () => void
  disabled?: boolean
}) {
  const s = useStyles()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [s.iconButton, pressed && s.pressed, disabled && s.disabled]}
    >
      <Icon name={name} />
    </Pressable>
  )
}
export function Action({
  label,
  onPress,
  busy = false,
  disabled = false,
  icon,
}: {
  label: string
  onPress: () => void
  busy?: boolean
  disabled?: boolean
  icon?: IconName
}) {
  const s = useStyles()
  const { colors } = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [s.action, pressed && s.pressed, (disabled || busy) && s.disabled]}
    >
      {icon ? <Icon name={icon} size={19} color={colors.onAccent} /> : null}
      <Text style={s.actionText}>{label}</Text>
    </Pressable>
  )
}
export function Screen({
  onClose,
  onRequestClose,
  onDismissStart,
  visible = true,
  instantIn = false,
  edge = 'right',
  swipeBack = false,
  dismissOnSwipe = true,
  insets = true,
  dismissRef,
  children,
}: {
  onClose: () => void
  onRequestClose?: () => void
  onDismissStart?: () => void
  visible?: boolean
  instantIn?: boolean
  edge?: 'right' | 'bottom'
  swipeBack?: boolean
  dismissOnSwipe?: boolean
  insets?: boolean
  dismissRef?: React.MutableRefObject<(after?: () => void) => void>
  children: React.ReactNode
}) {
  const { top, right, bottom, left } = useSafeAreaInsets()
  const { colors } = useTheme()
  const { width, height } = useWindowDimensions()
  const progress = useSharedValue(1)
  const dragStart = useSharedValue(1)
  const dragging = useSharedValue(false)
  const dismissing = useSharedValue(false)
  const [present, setPresent] = useState(visible)
  const [exiting, setExiting] = useState(false)
  const presentRef = useRef(visible)
  const shown = useRef(visible)
  const closing = useRef(false)
  const after = useRef<(() => void) | null>(null)
  const close = useRef(onClose)
  close.current = onClose
  const request = useRef(onRequestClose)
  request.current = onRequestClose
  const startDismiss = useRef(onDismissStart)
  startDismiss.current = onDismissStart
  const beginDismiss = useCallback(() => {
    setExiting(true)
    startDismiss.current?.()
  }, [])
  const finish = useCallback(() => {
    if (!shown.current) return
    shown.current = false
    const done = after.current
    after.current = null
    if (done) done()
    else close.current()
  }, [])
  // A swipe that may not dismiss still has to take the touches away from the
  // content, so it asks the screen to handle it like Back.
  const requestClose = useCallback(() => {
    request.current?.()
  }, [])
  const dismiss = useCallback(
    (done?: () => void) => {
      if (closing.current || !visible) return
      closing.current = true
      dismissing.value = true
      after.current = done ?? null
      beginDismiss()
      Keyboard.dismiss()
      progress.value = timing(1, { duration: 200 }, (finished) => {
        'worklet'
        if (finished) runOnJS(finish)()
      })
    },
    [beginDismiss, dismissing, finish, progress, visible]
  )
  const commit = useCallback(() => {
    if (closing.current) return
    closing.current = true
    dismissing.value = true
    beginDismiss()
    Keyboard.dismiss()
    finish()
  }, [beginDismiss, dismissing, finish])
  // The note behind a dismissed sheet has to be in place before the sheet moves,
  // so becoming visible is applied in the layout pass.
  useLayoutEffect(() => {
    if (visible) {
      closing.current = false
      dismissing.value = false
      setExiting(false)
      shown.current = true
      presentRef.current = true
      setPresent(true)
      progress.value = instantIn ? 0 : timing(0, { duration: 220 })
      return
    }
    if (!presentRef.current) return
    presentRef.current = false
    progress.value = timing(1, { duration: 200 }, (finished) => {
      'worklet'
      if (finished) runOnJS(setPresent)(false)
    })
  }, [dismissing, instantIn, visible, progress])
  useLayoutEffect(() => {
    if (dismissRef) dismissRef.current = dismiss
  }, [dismiss, dismissRef])
  useLayoutEffect(() => {
    if (!visible) return
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (request.current) request.current()
      else dismiss()
      return true
    })
    return () => subscription.remove()
  }, [dismiss, visible])
  const interactive = visible && !exiting
  const swipe = useMemo(
    () =>
      Gesture.Pan()
        .enabled(swipeBack && interactive)
        .activeOffsetX(8)
        .failOffsetY([-18, 18])
        .onStart(() => {
          'worklet'
          dragging.value = true
          dragStart.value = progress.value
          if (!dismissOnSwipe) runOnJS(requestClose)()
        })
        .onUpdate((event) => {
          'worklet'
          if (!dismissOnSwipe || dismissing.value) return
          const next = dragStart.value + event.translationX / Math.max(width, 1)
          progress.value = Math.max(0, Math.min(1, next))
        })
        .onEnd((event) => {
          'worklet'
          if (!dismissOnSwipe) {
            dragging.value = false
            return
          }
          if (dismissing.value) {
            dragging.value = false
            return
          }
          const projected = progress.value + (event.velocityX / Math.max(width, 1)) * 0.12
          if (projected > 0.34 || event.velocityX > 650) {
            dismissing.value = true
            runOnJS(beginDismiss)()
            progress.value = timing(1, { duration: 180 }, (finished) => {
              'worklet'
              if (finished) runOnJS(commit)()
            })
          } else {
            progress.value = spring(0, SCREEN_SPRING)
          }
        })
        .onFinalize((_event, success) => {
          'worklet'
          if (
            dismissOnSwipe &&
            !success &&
            dragging.value &&
            !dismissing.value &&
            progress.value > 0 &&
            progress.value < 1
          ) {
            progress.value = spring(0, SCREEN_SPRING)
          }
          dragging.value = false
        }),
    [
      beginDismiss,
      commit,
      dismissing,
      dismissOnSwipe,
      dragStart,
      dragging,
      interactive,
      progress,
      requestClose,
      swipeBack,
      width,
    ]
  )
  const motion = useAnimatedStyle(() => ({
    transform:
      edge === 'bottom'
        ? [{ translateY: progress.value * height }]
        : [{ translateX: progress.value * width }],
  }))
  return (
    <Reanimated.View
      style={[StyleSheet.absoluteFill, { zIndex: present ? 2 : 0, elevation: present ? 4 : 0 }]}
      pointerEvents={interactive ? 'auto' : 'none'}
      accessibilityViewIsModal={interactive}
      accessibilityElementsHidden={!interactive}
      importantForAccessibility={interactive ? 'auto' : 'no-hide-descendants'}
    >
      <Reanimated.View
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: colors.paper,
            paddingTop: insets ? top : 0,
            paddingRight: insets ? right : 0,
            paddingBottom: insets ? bottom : 0,
            paddingLeft: insets ? left : 0,
          },
          motion,
        ]}
      >
        {children}
      </Reanimated.View>
      {swipeBack && interactive ? (
        <GestureDetector gesture={swipe}>
          <View style={backEdgeStyle} />
        </GestureDetector>
      ) : null}
    </Reanimated.View>
  )
}

export function BottomSheet({
  title,
  leading,
  trailing,
  onClose,
  onRequestClose,
  busy = false,
  dismissRef,
  cardHeight,
  cardStyle,
  children,
}: {
  title: string
  leading?: React.ReactNode
  trailing?: React.ReactNode
  onClose: () => void
  onRequestClose?: () => boolean
  busy?: boolean
  dismissRef?: React.MutableRefObject<(after?: () => void) => void>
  cardHeight?: number
  cardStyle?: StyleProp<ViewStyle>
  children: React.ReactNode
}) {
  const s = useStyles()
  const { height } = useWindowDimensions()
  const { bottom, top } = useSafeAreaInsets()
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  const offset = useSharedValue(SHEET_REVEAL_TRAVEL)
  const reveal = useSharedValue(0)
  const start = useSharedValue(height)
  const dragging = useSharedValue(false)
  const dismissing = useSharedValue(false)
  const handle = useSharedValue(1)
  const closing = useRef(false)
  const after = useRef<(() => void) | null>(null)
  const close = useRef(onClose)
  close.current = onClose
  const request = useRef(onRequestClose)
  request.current = onRequestClose
  const finish = useCallback(() => {
    const done = after.current
    after.current = null
    if (done) done()
    else close.current()
  }, [])
  const commit = useCallback(() => {
    if (closing.current) return
    closing.current = true
    dismissing.value = true
    Keyboard.dismiss()
    finish()
  }, [dismissing, finish])
  const dismiss = useCallback(
    (done?: () => void) => {
      if (closing.current || busy) return
      closing.current = true
      dismissing.value = true
      after.current = done ?? null
      Keyboard.dismiss()
      reveal.value = timing(0, { duration: SHEET_CLOSE_DURATION, easing: SHEET_REVEAL_EASE })
      offset.value = timing(
        height,
        { duration: SHEET_CLOSE_DURATION, easing: SHEET_REVEAL_EASE },
        (finished) => {
          'worklet'
          if (finished) runOnJS(finish)()
        }
      )
    },
    [busy, dismissing, finish, height, offset, reveal]
  )
  useLayoutEffect(() => {
    if (dismissRef) dismissRef.current = dismiss
  }, [dismiss, dismissRef])
  useEffect(() => {
    reveal.value = timing(1, { duration: SHEET_OPEN_DURATION, easing: SHEET_REVEAL_EASE })
    offset.value = timing(0, { duration: SHEET_OPEN_DURATION, easing: SHEET_REVEAL_EASE })
  }, [offset, reveal])
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (event) =>
      setKeyboardHeight(event.endCoordinates.height)
    )
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0))
    return () => {
      show.remove()
      hide.remove()
    }
  }, [])
  const keyboardMaxHeight =
    keyboardHeight > 0 ? Math.max(200, height - keyboardHeight - top) : undefined
  useLayoutEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (busy) return true
      if (request.current?.()) return true
      dismiss()
      return true
    })
    return () => subscription.remove()
  }, [busy, dismiss])
  const drag = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!busy)
        .activeOffsetY([-8, 8])
        .failOffsetX([-24, 24])
        .onStart(() => {
          'worklet'
          if (dismissing.value) {
            dragging.value = false
            return
          }
          dragging.value = true
          start.value = offset.value
          handle.value = spring(1.3, SWIPE_SPRING)
        })
        .onUpdate((event) => {
          'worklet'
          if (!dragging.value || dismissing.value) return
          const raw = start.value + event.translationY
          // Sheets only move down. Letting the handle drift up made the card
          // float and clip against the bottom of the screen.
          offset.value = Math.max(0, raw)
        })
        .onEnd((event) => {
          'worklet'
          if (!dragging.value || dismissing.value) return
          const projected = offset.value + event.velocityY * 0.08
          if (projected > Math.min(height * 0.22, 140) || event.velocityY > 850) {
            dismissing.value = true
            offset.value = timing(height, { duration: 200 }, (finished) => {
              'worklet'
              if (finished) runOnJS(commit)()
            })
          } else {
            offset.value = spring(0, SHEET_SPRING)
          }
        })
        .onFinalize((_event, success) => {
          'worklet'
          if (!success && dragging.value && !dismissing.value && offset.value !== 0) {
            offset.value = spring(0, SHEET_SPRING)
          }
          dragging.value = false
          handle.value = spring(1, SWIPE_SPRING)
        }),
    [busy, commit, dismissing, dragging, handle, height, offset, start]
  )
  const backdrop = useAnimatedStyle(() => ({
    // Fade in with the reveal, then follow the card while it is dragged down.
    opacity: Math.min(
      reveal.value,
      interpolate(offset.value, [0, Math.max(height * 0.5, 1)], [1, 0], Extrapolation.CLAMP)
    ),
  }))
  const cardMotion = useAnimatedStyle(() => ({
    transform: [{ translateY: offset.value }],
    opacity: reveal.value,
    filter: [{ blur: (1 - reveal.value) * SHEET_REVEAL_BLUR }],
  }))
  const handleMotion = useAnimatedStyle(() => ({ transform: [{ scaleX: handle.value }] }))
  const header = (
    <View>
      <View style={s.sheetGrabber}>
        <Reanimated.View style={[s.sheetHandle, handleMotion]} />
      </View>
      <View style={s.sheetHeader}>
        {leading}
        <View style={s.flex}>
          <Text accessibilityRole="header" style={s.sheetTitle}>
            {title}
          </Text>
        </View>
        {trailing}
      </View>
    </View>
  )
  const card = (
    <Reanimated.View
      style={[
        s.sheetCard,
        { paddingBottom: Math.max(bottom, 24) },
        cardHeight !== undefined && { height: cardHeight },
        keyboardMaxHeight !== undefined && { maxHeight: keyboardMaxHeight },
        cardStyle,
        cardMotion,
      ]}
    >
      <GestureDetector gesture={drag}>{header}</GestureDetector>
      {children}
    </Reanimated.View>
  )
  return (
    <View
      style={[StyleSheet.absoluteFill, s.sheetOverlay, { zIndex: 12, elevation: 12 }]}
      accessibilityViewIsModal
    >
      <Reanimated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, s.sheetBackdrop, backdrop]}
      />
      <Pressable
        accessibilityLabel={`Dismiss ${title.toLowerCase()}`}
        disabled={busy}
        onPress={() => dismiss()}
        style={StyleSheet.absoluteFill}
      />
      <KeyboardAvoidingView
        behavior={keyboardBehavior}
        style={s.sheetKeyboard}
        pointerEvents="box-none"
      >
        {card}
      </KeyboardAvoidingView>
    </View>
  )
}

type DialogHostValue = {
  mount: (id: number, node: React.ReactNode) => void
  unmount: (id: number) => void
}

const DialogHostContext = createContext<DialogHostValue | null>(null)
let dialogSequence = 0

export function DialogHost({ children }: { children: React.ReactNode }) {
  const [nodes, setNodes] = useState<{ id: number; node: React.ReactNode }[]>([])
  const value = useMemo<DialogHostValue>(
    () => ({
      mount: (id, node) =>
        setNodes((previous) => [...previous.filter((entry) => entry.id !== id), { id, node }]),
      unmount: (id) => setNodes((previous) => previous.filter((entry) => entry.id !== id)),
    }),
    []
  )
  return (
    <DialogHostContext.Provider value={value}>
      {children}
      {nodes.map(({ id, node }) => (
        <Fragment key={id}>{node}</Fragment>
      ))}
    </DialogHostContext.Provider>
  )
}

function Portal({ children }: { children: React.ReactNode }) {
  const host = useContext(DialogHostContext)
  const [id] = useState(() => ++dialogSequence)
  useLayoutEffect(() => {
    host?.mount(id, children)
    return () => host?.unmount(id)
  }, [children, host, id])
  return null
}

function Dialog({
  visible,
  title,
  message,
  onClose,
  local = false,
  children,
}: {
  visible: boolean
  title: string
  message?: string
  onClose(): void
  local?: boolean
  children: React.ReactNode
}) {
  const s = useStyles()
  const progress = useSharedValue(0)
  useEffect(() => {
    // Reset while hidden, so the next opening does not start halfway in.
    if (!visible) {
      progress.value = 0
      return
    }
    progress.value = spring(1, SHEET_SPRING)
  }, [progress, visible])
  useEffect(() => {
    if (!visible) return
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose()
      return true
    })
    return () => subscription.remove()
  }, [onClose, visible])
  const dim = useAnimatedStyle(() => ({ opacity: progress.value }))
  const card = useAnimatedStyle(() => ({
    transform: [{ scale: 0.94 + progress.value * 0.06 }],
  }))
  if (!visible) return null
  // A native Modal re-composites the WebView behind it and makes the source
  // flash. Keep the overlay in the same subtree as the WebView as well, so the
  // dim actually paints over the editor instead of behind it.
  const content = (
    <View style={[StyleSheet.absoluteFill, s.dialogOverlay, s.dialogLayer]}>
      <Reanimated.View pointerEvents="none" style={[StyleSheet.absoluteFill, s.dialogDim, dim]} />
      <Pressable
        accessibilityLabel="Dismiss dialog"
        onPress={onClose}
        style={StyleSheet.absoluteFill}
      />
      <Reanimated.View style={[s.dialogCard, card]} accessibilityViewIsModal>
        <Text accessible accessibilityRole="header" style={s.dialogTitle}>
          {title}
        </Text>
        {message && (
          <Text accessible style={s.dialogMessage}>
            {message}
          </Text>
        )}
        {children}
      </Reanimated.View>
    </View>
  )
  return local ? content : <Portal>{content}</Portal>
}

export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Keep editing',
  local = false,
  onCancel,
  onConfirm,
}: {
  visible: boolean
  title: string
  message: string
  confirmLabel: string
  cancelLabel?: string
  local?: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const s = useStyles()
  return (
    <Dialog visible={visible} title={title} message={message} onClose={onCancel} local={local}>
      <View style={s.dialogActions}>
        <Pressable
          accessibilityRole="button"
          onPress={onCancel}
          style={({ pressed }) => [s.dialogCancel, pressed && s.pressed]}
        >
          <Text style={s.dialogCancelText}>{cancelLabel}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onConfirm}
          style={({ pressed }) => [s.dialogConfirm, pressed && s.pressed]}
        >
          <Text style={s.dialogConfirmText}>{confirmLabel}</Text>
        </Pressable>
      </View>
    </Dialog>
  )
}
