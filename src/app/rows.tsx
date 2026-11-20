import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { StyleProp, ViewStyle } from 'react-native'
import { Pressable, Text, Vibration, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Reanimated, {
  cancelAnimation,
  interpolateColor,
  ReduceMotion,
  runOnJS,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { rgba } from '../color'
import { notePreview, noteTime } from '../core'
import { Icon } from '../icons'
import { SWIPE_CARD_REVEAL, SWIPE_CHIP_REVEAL } from '../library-rows'
import { luminance, useTheme } from '../theme'
import type { Note, SearchResult } from '../types'
import { timing } from './motion'
import {
  type FolderEntry,
  folderPathLabel,
  type LibraryNotice as NoticeData,
  PANE_OVERLAP,
  parentFolder,
  type RowAction,
  SWIPE_SPRING,
} from './shared'
import { useStyles } from './styles'

const ESCAPE_PATTERN = /[.*+?^${}()|[\]\\]/gu
const escapePattern = (value: string) => value.replace(ESCAPE_PATTERN, '\\$&')

function commonPrefixLength(value: string, needle: string): number {
  let index = 0
  while (index < value.length && index < needle.length && value[index] === needle[index]) index++
  return index
}

function HighlightedText({
  text,
  query,
  style,
  numberOfLines,
  fuzzy = false,
}: {
  text: string
  query: string
  style: React.ComponentProps<typeof Text>['style']
  numberOfLines?: number
  fuzzy?: boolean
}) {
  const s = useStyles()
  const { colors } = useTheme()
  const hitStyle = [s.highlight, { backgroundColor: rgba(colors.accent, 0.28) }]
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) {
    return (
      <Text numberOfLines={numberOfLines} style={style}>
        {text}
      </Text>
    )
  }
  const haystack = text.toLocaleLowerCase()
  const terms = needle.split(/\s+/u).filter(Boolean)
  let parts: { text: string; hit: boolean }[] = []
  if (terms.length > 1) {
    // Multi-term snippets rarely contain the whole query in one run, so light
    // up every term that made the note a hit.
    const pattern = new RegExp(terms.map(escapePattern).join('|'), 'giu')
    let offset = 0
    for (const match of text.matchAll(pattern)) {
      const at = match.index ?? 0
      if (at > offset) parts.push({ text: text.slice(offset, at), hit: false })
      parts.push({ text: match[0], hit: true })
      offset = at + match[0].length
    }
    if (offset < text.length) parts.push({ text: text.slice(offset), hit: false })
  } else {
    let offset = 0
    for (;;) {
      const at = haystack.indexOf(needle, offset)
      if (at < 0) break
      if (at > offset) parts.push({ text: text.slice(offset, at), hit: false })
      parts.push({ text: text.slice(at, at + needle.length), hit: true })
      offset = at + needle.length
    }
    if (offset < text.length) parts.push({ text: text.slice(offset), hit: false })
    if (fuzzy && !parts.some((part) => part.hit)) {
      // Fuzzy matches still need a visible anchor. Highlight the shared prefix,
      // so a search like "tesg" lights up "Tes" in "Test".
      const prefix = commonPrefixLength(haystack, needle)
      if (prefix > 0) {
        parts = [
          { text: text.slice(0, prefix), hit: true },
          ...(prefix < text.length ? [{ text: text.slice(prefix), hit: false }] : []),
        ]
      }
    }
  }
  let cursor = 0
  return (
    <Text numberOfLines={numberOfLines} style={style}>
      {parts.map((part) => {
        const key = `${cursor}:${part.hit ? 'hit' : 'text'}`
        cursor += part.text.length
        return part.hit ? (
          <Text key={key} style={hitStyle}>
            {part.text}
          </Text>
        ) : (
          <Text key={key}>{part.text}</Text>
        )
      })}
    </Text>
  )
}

function searchPreview(note: Note, query: string): string | undefined {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return undefined
  const lines = note.source.split('\n')
  const title = lines.findIndex(
    (line) => /^\s*=/u.test(line) && line.toLocaleLowerCase().includes(needle)
  )
  for (let index = 0; index < lines.length; index++) {
    if (index === title) continue
    const line = lines[index].trim()
    if (line.toLocaleLowerCase().includes(needle)) {
      const text = line.length > 180 ? `${line.slice(0, 180)}…` : line
      return `…${text}…`
    }
  }
  return undefined
}

export const SearchResultRow = memo(
  function SearchResultRow({
    result,
    query,
    favorite,
    vaultName,
    onPress,
    onLongPress,
    onToggleFavorite,
    onTrash,
  }: {
    result: SearchResult
    query: string
    favorite: boolean
    vaultName: string
    onPress: (result: SearchResult) => void
    onLongPress: (result: SearchResult) => void
    onToggleFavorite: (result: SearchResult) => void
    onTrash: (result: SearchResult) => void
  }) {
    const s = useStyles()
    const { colors } = useTheme()
    const parent = parentFolder(result.note.path)
    const needle = query.trim().toLocaleLowerCase()
    const terms = needle.split(/\s+/u).filter(Boolean)
    const preview = result.snippet ?? searchPreview(result.note, query)
    // A fuzzy single-term hit may have no literal query to highlight, so hide
    // that excerpt. Multi-term snippets are always from real term hits.
    const snippet =
      preview && (terms.length > 1 || (needle && preview.toLocaleLowerCase().includes(needle)))
        ? preview
        : undefined
    return (
      <SwipeRow
        favorite={favorite}
        noun="note"
        label={`${result.note.title}, ${result.note.path}`}
        reveal={SWIPE_CARD_REVEAL}
        shellStyle={s.cardShell}
        rowStyle={s.cardRow}
        onPress={() => onPress(result)}
        onLongPress={() => onLongPress(result)}
        onToggleFavorite={() => onToggleFavorite(result)}
        onTrash={() => onTrash(result)}
      >
        <View style={s.cardHead}>
          <HighlightedText
            text={result.note.title}
            query={query}
            numberOfLines={1}
            fuzzy
            style={s.cardTitle}
          />
          <View style={s.cardMeta}>
            {favorite ? (
              <Icon name="star" size={14} color={colors.accent} fill={colors.accent} />
            ) : null}
            <Text numberOfLines={1} style={s.cardTime}>
              {folderPathLabel(parent, vaultName)}
            </Text>
          </View>
        </View>
        {snippet ? (
          <HighlightedText text={snippet} query={query} numberOfLines={2} style={s.cardPreview} />
        ) : null}
      </SwipeRow>
    )
  },
  (previous, next) =>
    previous.result.note === next.result.note &&
    previous.result.snippet === next.result.snippet &&
    previous.query === next.query &&
    previous.favorite === next.favorite &&
    previous.vaultName === next.vaultName &&
    previous.onPress === next.onPress &&
    previous.onLongPress === next.onLongPress &&
    previous.onToggleFavorite === next.onToggleFavorite &&
    previous.onTrash === next.onTrash
)

// A row owns its pan so the translation, pane, and spring run on the UI
// thread. React only hears about the chosen side and the arm threshold, never
// about individual frames.

function SwipePane({
  pane,
  translateX,
  armed,
  favorite,
  reveal,
}: {
  pane: RowAction
  translateX: SharedValue<number>
  armed: boolean
  favorite: boolean
  reveal: number
}) {
  const s = useStyles()
  const { colors } = useTheme()
  const label = pane === 'favorite' ? (favorite ? 'Unpin' : 'Pin') : 'Trash'
  const tint =
    pane === 'favorite' ? colors.onAccent : luminance(colors.coral) > 0.179 ? '#000000' : '#ffffff'
  const contentStyle = useAnimatedStyle(() => {
    const progress = Math.min(Math.abs(translateX.value) / reveal, 1)
    return {
      opacity: progress,
      transform: [{ scale: 0.9 + 0.16 * progress }],
    }
  })
  const paneStyle = useAnimatedStyle(() => ({ width: Math.abs(translateX.value) + PANE_OVERLAP }))
  return (
    <Reanimated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        s.swipePane,
        pane === 'favorite' ? s.swipePaneFavorite : s.swipePaneTrash,
        { backgroundColor: pane === 'favorite' ? colors.accent : colors.coral },
        paneStyle,
      ]}
    >
      <Reanimated.View style={[s.swipePaneContent, contentStyle]}>
        {pane === 'favorite' ? (
          <>
            <Icon name="star" size={18} color={tint} fill={armed ? tint : 'none'} />
            <Text style={[s.swipePaneLabel, { color: tint }]}>{armed ? 'Release' : label}</Text>
          </>
        ) : (
          <>
            <Text style={[s.swipePaneLabel, { color: tint }]}>{armed ? 'Release' : label}</Text>
            <Icon name="trash" size={18} color={tint} fill={armed ? tint : 'none'} />
          </>
        )}
      </Reanimated.View>
    </Reanimated.View>
  )
}

function SwipeRow({
  favorite,
  noun,
  label,
  reveal,
  shellStyle,
  rowStyle,
  onPressIn,
  onPress,
  onLongPress,
  onToggleFavorite,
  onTrash,
  children,
}: {
  favorite: boolean
  noun: 'note' | 'folder'
  label: string
  reveal: number
  shellStyle: StyleProp<ViewStyle>
  rowStyle: StyleProp<ViewStyle>
  onPressIn?: () => void
  onPress: () => void
  onLongPress: () => void
  onToggleFavorite: () => void
  onTrash: () => void
  children: React.ReactNode
}) {
  const s = useStyles()
  const { colors } = useTheme()
  const translateX = useSharedValue(0)
  const pressed = useSharedValue(0)
  const side = useSharedValue(0)
  const armedValue = useSharedValue(false)
  const [pane, setPane] = useState<RowAction | null>(null)
  const [armed, setArmed] = useState(false)
  const live = useRef({ onPressIn, onPress, onLongPress, onToggleFavorite, onTrash })
  live.current = { onPressIn, onPress, onLongPress, onToggleFavorite, onTrash }
  const showPane = useCallback((next: number) => {
    setPane(next === 1 ? 'favorite' : 'trash')
  }, [])
  const hidePane = useCallback(() => {
    setPane(null)
    setArmed(false)
  }, [])
  const changeArmed = useCallback((next: boolean) => {
    if (next) Vibration.vibrate(10)
    setArmed(next)
  }, [])
  const invokePress = useCallback(() => live.current.onPress(), [])
  const invokeLongPress = useCallback(() => live.current.onLongPress(), [])
  const invokePressIn = useCallback(() => live.current.onPressIn?.(), [])
  const invokeFavorite = useCallback(() => live.current.onToggleFavorite(), [])
  const invokeTrash = useCallback(() => live.current.onTrash(), [])
  const gesture = useMemo(() => {
    const settle = () => {
      'worklet'
      translateX.value = withSpring(
        0,
        { ...SWIPE_SPRING, reduceMotion: ReduceMotion.System },
        (finished) => {
          if (finished) runOnJS(hidePane)()
        }
      )
    }
    const pan = Gesture.Pan()
      .activeOffsetX([-8, 8])
      .failOffsetY([-12, 12])
      .onStart(() => {
        cancelAnimation(pressed)
        pressed.value = withTiming(0, { duration: 80, reduceMotion: ReduceMotion.System })
      })
      .onUpdate((event) => {
        if (side.value === 0) {
          if (event.translationX > 6) {
            side.value = 1
            runOnJS(showPane)(1)
          } else if (event.translationX < -6) {
            side.value = -1
            runOnJS(showPane)(-1)
          } else return
        }
        const raw = event.translationX
        // Clamp at the origin so crossing back never reveals the other
        // action's color on the wrong edge.
        const travel = side.value === 1 ? Math.max(raw, 0) : Math.min(raw, 0)
        let next = travel
        if (side.value === 1 && travel > reveal)
          next = reveal + Math.min(14, (travel - reveal) * 0.12)
        else if (side.value === -1 && travel < -reveal)
          next = -reveal - Math.min(14, (-travel - reveal) * 0.12)
        translateX.value = next
        const nextArmed = side.value === 1 ? next >= reveal : next <= -reveal
        if (nextArmed !== armedValue.value) {
          armedValue.value = nextArmed
          runOnJS(changeArmed)(nextArmed)
        }
      })
      .onEnd(() => {
        const current = side.value
        // The label is the contract: commit only while it reads Release, so a
        // quick flick back below the threshold cannot trigger the action.
        if (current === 0 || !armedValue.value) return
        translateX.value = 0
        side.value = 0
        armedValue.value = false
        if (current === 1) runOnJS(invokeFavorite)()
        else runOnJS(invokeTrash)()
      })
      .onFinalize(() => {
        cancelAnimation(pressed)
        pressed.value = withTiming(0, { duration: 120, reduceMotion: ReduceMotion.System })
        if (translateX.value !== 0) settle()
        else runOnJS(hidePane)()
        side.value = 0
        armedValue.value = false
      })
    const tap = Gesture.Tap()
      .maxDistance(10)
      .onBegin(() => {
        runOnJS(invokePressIn)()
        // Show the hold affordance after a short delay, so a swipe never
        // flashes it and a quick tap stays quiet.
        cancelAnimation(pressed)
        pressed.value = withDelay(
          180,
          withTiming(1, { duration: 90, reduceMotion: ReduceMotion.System })
        )
      })
      .onEnd((_event, success) => {
        if (success) runOnJS(invokePress)()
      })
      .onFinalize(() => {
        cancelAnimation(pressed)
        pressed.value = withTiming(0, { duration: 120, reduceMotion: ReduceMotion.System })
      })
    const hold = Gesture.LongPress()
      .minDuration(350)
      .maxDistance(12)
      .onStart(() => runOnJS(invokeLongPress)())
    return Gesture.Race(pan, hold, tap)
  }, [
    armedValue,
    changeArmed,
    hidePane,
    invokeFavorite,
    invokeLongPress,
    invokePress,
    invokePressIn,
    invokeTrash,
    pressed,
    reveal,
    showPane,
    side,
    translateX,
  ])
  const translateStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }))
  const pressedStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(pressed.value, [0, 1], [colors.soft, colors.surfaceHi]),
  }))
  const hint = `Swipe right and release to ${favorite ? 'unpin' : 'pin'} this ${noun}, or swipe left and release to move it to trash.`
  return (
    <View style={[s.swipeShell, shellStyle]}>
      <GestureDetector gesture={gesture}>
        <Reanimated.View style={[s.swipeForeground, translateStyle]} renderToHardwareTextureAndroid>
          <Reanimated.View
            accessible
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityHint={`${hint} Long press to move this ${noun}.`}
            accessibilityActions={[
              { name: 'favorite', label: favorite ? 'Remove from favorites' : 'Add to favorites' },
              { name: 'trash', label: 'Move to trash' },
              { name: 'move', label: 'Move to folder' },
            ]}
            onAccessibilityAction={(event) => {
              const action = event.nativeEvent.actionName
              if (action === 'favorite') live.current.onToggleFavorite()
              else if (action === 'trash') live.current.onTrash()
              else if (action === 'move') live.current.onLongPress()
            }}
            style={[s.swipeFill, rowStyle, pressedStyle]}
          >
            {children}
          </Reanimated.View>
        </Reanimated.View>
      </GestureDetector>
      {pane !== null ? (
        <SwipePane
          pane={pane}
          translateX={translateX}
          armed={armed}
          favorite={favorite}
          reveal={reveal}
        />
      ) : null}
    </View>
  )
}

export const FolderChip = memo(
  function FolderChip({
    entry,
    count,
    favorite,
    onPress,
    onLongPress,
    onToggleFavorite,
    onTrash,
  }: {
    entry: FolderEntry
    count: number
    favorite: boolean
    onPress: (path: string) => void
    onLongPress: (entry: FolderEntry) => void
    onToggleFavorite: (entry: FolderEntry) => void
    onTrash: (entry: FolderEntry) => void
  }) {
    const s = useStyles()
    const { colors } = useTheme()
    return (
      <SwipeRow
        favorite={favorite}
        noun="folder"
        label={`Folder ${entry.name}, ${count} note${count === 1 ? '' : 's'}`}
        reveal={SWIPE_CHIP_REVEAL}
        shellStyle={s.chipShell}
        rowStyle={s.chipRow}
        onPress={() => onPress(entry.path)}
        onLongPress={() => onLongPress(entry)}
        onToggleFavorite={() => onToggleFavorite(entry)}
        onTrash={() => onTrash(entry)}
      >
        <Icon name="folder" size={20} color={colors.accent} />
        <Text numberOfLines={1} style={s.chipName}>
          {entry.name}
        </Text>
        {favorite ? (
          <Icon name="star" size={14} color={colors.accent} fill={colors.accent} />
        ) : null}
        <Text style={s.chipCount}>{count}</Text>
      </SwipeRow>
    )
  },
  (previous, next) =>
    previous.entry.path === next.entry.path &&
    previous.entry.name === next.entry.name &&
    previous.count === next.count &&
    previous.favorite === next.favorite &&
    previous.onPress === next.onPress &&
    previous.onLongPress === next.onLongPress &&
    previous.onToggleFavorite === next.onToggleFavorite &&
    previous.onTrash === next.onTrash
)

export const NoteCard = memo(
  function NoteCard({
    result,
    favorite,
    onPressIn,
    onPress,
    onLongPress,
    onToggleFavorite,
    onTrash,
  }: {
    result: SearchResult
    favorite: boolean
    onPressIn: (result: SearchResult) => void
    onPress: (result: SearchResult) => void
    onLongPress: (result: SearchResult) => void
    onToggleFavorite: (result: SearchResult) => void
    onTrash: (result: SearchResult) => void
  }) {
    const s = useStyles()
    const { colors } = useTheme()
    const { note } = result
    const time = noteTime(note.modifiedAt)
    const preview = notePreview(note)
    return (
      <SwipeRow
        favorite={favorite}
        noun="note"
        label={`${note.title}, ${note.path}`}
        reveal={SWIPE_CARD_REVEAL}
        shellStyle={s.cardShell}
        rowStyle={s.cardRow}
        onPressIn={() => onPressIn(result)}
        onPress={() => onPress(result)}
        onLongPress={() => onLongPress(result)}
        onToggleFavorite={() => onToggleFavorite(result)}
        onTrash={() => onTrash(result)}
      >
        <View style={s.cardHead}>
          <Text numberOfLines={1} style={s.cardTitle}>
            {note.title}
          </Text>
          {time || favorite ? (
            <View style={s.cardMeta}>
              {favorite ? (
                <Icon name="star" size={14} color={colors.accent} fill={colors.accent} />
              ) : null}
              {time ? <Text style={s.cardTime}>{time}</Text> : null}
            </View>
          ) : null}
        </View>
        {preview ? (
          <Text numberOfLines={2} style={s.cardPreview}>
            {preview}
          </Text>
        ) : null}
      </SwipeRow>
    )
  },
  (previous, next) =>
    previous.result.note === next.result.note &&
    previous.favorite === next.favorite &&
    previous.onPressIn === next.onPressIn &&
    previous.onPress === next.onPress &&
    previous.onLongPress === next.onLongPress &&
    previous.onToggleFavorite === next.onToggleFavorite &&
    previous.onTrash === next.onTrash
)
function useNoticeMotion(onDone: () => void, duration = 3200) {
  const opacity = useSharedValue(0)
  const done = useRef(onDone)
  done.current = onDone
  const alive = useRef(true)
  const notify = useCallback(() => {
    if (alive.current) done.current()
  }, [])
  useEffect(() => {
    alive.current = true
    opacity.value = timing(1, { duration: 180 })
    const timer = setTimeout(() => {
      opacity.value = timing(0, { duration: 180 }, (finished) => {
        'worklet'
        if (finished) runOnJS(notify)()
      })
    }, duration)
    return () => {
      alive.current = false
      clearTimeout(timer)
      opacity.value = 0
    }
  }, [duration, notify, opacity])
  return useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: (1 - opacity.value) * 10 }],
  }))
}

export function LibraryNotice({ notice, onDone }: { notice: NoticeData; onDone: () => void }) {
  const s = useStyles()
  const { colors } = useTheme()
  const motion = useNoticeMotion(onDone)
  return (
    <Reanimated.View
      accessibilityLiveRegion="polite"
      pointerEvents="none"
      style={[s.notice, motion]}
    >
      <View style={s.noticeIcon}>
        <Icon name={notice.icon} size={18} color={colors.accent} />
      </View>
      <View style={s.flex}>
        <Text style={s.noticeTitle}>{notice.title}</Text>
        {notice.body ? (
          <Text numberOfLines={1} style={s.noticeBody}>
            {notice.body}
          </Text>
        ) : null}
      </View>
    </Reanimated.View>
  )
}

export function TrashNotice({
  title,
  onUndo,
  onDone,
}: {
  title: string
  onUndo?: () => void
  onDone: () => void
}) {
  const s = useStyles()
  const { colors } = useTheme()
  const motion = useNoticeMotion(onDone, onUndo ? 5000 : 3200)
  return (
    <Reanimated.View accessibilityLiveRegion="polite" style={[s.trashNotice, motion]}>
      <View style={s.trashNoticeIcon}>
        <Icon name="trash" size={20} color={colors.onAccent} />
      </View>
      <View style={s.flex}>
        <Text style={s.trashNoticeTitle}>Moved to trash</Text>
        <Text numberOfLines={1} style={s.trashNoticeBody}>
          {title}
        </Text>
      </View>
      {onUndo ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Undo move to trash"
          onPress={onUndo}
          style={({ pressed }) => [s.trashUndo, pressed && s.pressed]}
        >
          <Text style={s.trashUndoText}>Undo</Text>
        </Pressable>
      ) : null}
    </Reanimated.View>
  )
}
