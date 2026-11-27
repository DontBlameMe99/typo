import * as FileSystem from 'expo-file-system/legacy'
import * as IntentLauncher from 'expo-intent-launcher'
import * as Sharing from 'expo-sharing'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  AccessibilityInfo,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import Reanimated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { PdfWorkspace } from '../compiler/workspace'
import { isRootTemplate } from '../core'
import { ErrorBanner } from '../ErrorBanner'
import { Icon } from '../icons'
import Pdf from '../PdfViewer'
import { SourceEditor, type SourceEditorHandle } from '../SourceEditor'
import { useTheme } from '../theme'
import type { Note } from '../types'
import { useAutoPdf } from '../useAutoPdf'
import { preparePdf, prepareSource, readNote, saveNote } from '../vault'
import { findFirst, findMatches, initialFindSelection } from './find'
import { Fade, IconFade, PillTabs, SLIDE_TIMING, Ticker, timing } from './motion'
import { errorText, keyboardBehavior } from './shared'
import { useStyles } from './styles'
import { Action, IconButton, Screen } from './ui'

const NOTE_MODE_OPTIONS = [
  { value: 'source', label: 'Source' },
  { value: 'pdf', label: 'PDF' },
] as const

const AUTO_SAVE_DELAY = 600

export function NoteDetail(props: Parameters<typeof NoteDetailScreen>[0]) {
  const { note, session } = props
  return <NoteDetailScreen key={`${note.uri}:${session}`} {...props} />
}

function isSyncConflict(message: string | null): boolean {
  return (
    !!message &&
    (message.includes('changed outside this editor') || message.includes('changed on disk'))
  )
}
function NoteDetailScreen({
  workspace,
  active,
  instantIn,
  onPrepared,
  session,
  note,
  opening = false,
  openError,
  initialLine,
  initialQuery,
  onClose,
  onSave,
  onSaveError,
}: {
  workspace: PdfWorkspace
  active: boolean
  instantIn: boolean
  onPrepared: (session: number) => void
  session: number
  note: Note
  opening?: boolean
  openError?: string
  initialLine?: number
  initialQuery: string
  onClose: () => void
  onSave: (note: Note) => void
  onSaveError: (message: string) => void
}) {
  const s = useStyles()
  const { colors } = useTheme()
  const { top } = useSafeAreaInsets()
  const documentId = `${note.uri}:${session}`
  const [savedNote, setSavedNote] = useState(note)
  const [source, setSource] = useState(note.source)
  const [mode, setMode] = useState<'source' | 'pdf'>('source')
  const [find, setFind] = useState(initialQuery)
  const [findOpen, setFindOpen] = useState(!!initialQuery || !!initialLine)
  const [focusFind, setFocusFind] = useState(false)
  const findInput = useRef<React.ComponentRef<typeof TextInput>>(null)
  const [barArea, setBarArea] = useState(0)
  const [contentWidth, setContentWidth] = useState(0)
  const page = useSharedValue(mode === 'pdf' ? 1 : 0)
  const sourceSlide = useAnimatedStyle(() => ({
    transform: [{ translateX: -page.value * contentWidth }],
  }))
  const pdfSlide = useAnimatedStyle(() => ({
    transform: [{ translateX: (1 - page.value) * contentWidth }],
  }))
  useEffect(() => {
    page.value = timing(mode === 'pdf' ? 1 : 0, SLIDE_TIMING)
  }, [mode, page])
  const findProgress = useSharedValue(findOpen ? 1 : 0)
  const barTrackStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -findProgress.value * barArea }],
  }))
  useEffect(() => {
    findProgress.value = timing(findOpen ? 1 : 0, { duration: 220 })
    if (!findOpen || !focusFind) return
    const timer = setTimeout(() => findInput.current?.focus(), 80)
    return () => clearTimeout(timer)
  }, [findOpen, findProgress, focusFind])
  const [matchIndex, setMatchIndex] = useState(0)
  const [selection, setSelection] = useState<{ start: number; end: number } | undefined>()
  const [sharing, setSharing] = useState(false)
  const [openingPdf, setOpeningPdf] = useState(false)
  const [pdfReloadEpoch, setPdfReloadEpoch] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const shareEpoch = useRef(0)
  const alive = useRef(true)
  const editor = useRef<SourceEditorHandle>(null)
  const pendingSave = useRef<ReturnType<typeof setTimeout> | null>(null)
  const writing = useRef<Promise<string | null> | null>(null)
  const closing = useRef(false)
  // The bar carries no title, so the note is named for screen readers once per
  // open rather than on every title-changing autosave.
  const announced = useRef<string | null>(null)
  const dismiss = useRef<(after?: () => void) => void>(() => {})
  const editState = useRef({ documentId, source, savedNote, active, opening })
  editState.current = { documentId, source, savedNote, active, opening }
  useLayoutEffect(() => {
    const current = editState.current
    if (note.source === current.savedNote.source) return
    if (current.source === current.savedNote.source) {
      setSavedNote(note)
      setSource(note.source)
    } else {
      setError(
        'The file changed on disk while opening. Your edits have been kept. Reopen the note to load the file.'
      )
    }
  }, [note])
  const autoPdf = useAutoPdf({ note: savedNote, source, workspace, enabled: active })
  useEffect(() => {
    if (!active) {
      announced.current = null
      return
    }
    // The cached title can be stale until the opening read lands.
    if (opening) return
    if (announced.current === documentId) return
    announced.current = documentId
    AccessibilityInfo.announceForAccessibility(note.title)
  }, [active, documentId, note.title, opening])
  useEffect(() => {
    if (autoPdf.preview?.uri) setPdfError(null)
  }, [autoPdf.preview?.uri])
  const matches = useMemo(() => findMatches(source, find), [source, find])
  const matchCount = matches.length
  const matchCurrent = matchCount ? Math.min(matchIndex + 1, matchCount) : 0
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  useEffect(() => {
    const current = editState.current
    if (current.documentId !== documentId || current.source !== current.savedNote.source) return
    const initial = initialFindSelection(note.source, initialLine, initialQuery)
    if (initial) {
      setSelection(initial.selection)
      if (initial.matchIndex !== undefined) setMatchIndex(initial.matchIndex)
    }
  }, [initialLine, initialQuery, note.source, documentId])

  async function close() {
    if (closing.current) return
    closing.current = true
    shareEpoch.current++
    setSharing(false)
    editor.current?.blur()
    Keyboard.dismiss()
    const failure = await flushSave()
    closing.current = false
    // The note leaves the screen, so the library has to carry the failure.
    if (failure) onSaveError(failure)
    onClose()
  }
  function switchMode(next: 'source' | 'pdf') {
    if (next === mode) return
    if (findOpen) closeFind()
    editor.current?.blur()
    Keyboard.dismiss()
    if (next === 'pdf') setEditing(false)
    setMode(next)
  }
  // Callers share the write in flight, so two saves never race each other.
  function save(): Promise<string | null> {
    writing.current ??= write().finally(() => {
      writing.current = null
    })
    return writing.current
  }
  async function write(): Promise<string | null> {
    for (;;) {
      const current = editState.current
      if (current.source === current.savedNote.source) return null
      const source = current.source
      setError(null)
      try {
        const saved = await saveNote(current.savedNote, source)
        const updated = { ...current.savedNote, ...saved, pdfHash: undefined }
        // Stay ahead of React so the next write compares against the file we just wrote.
        editState.current.savedNote = updated
        if (alive.current) setSavedNote(updated)
        onSave(updated)
      } catch (cause) {
        const message = errorText(cause)
        if (alive.current) setError(message)
        return message
      }
    }
  }
  function scheduleSave() {
    if (pendingSave.current) clearTimeout(pendingSave.current)
    pendingSave.current = setTimeout(() => {
      pendingSave.current = null
      void save()
    }, AUTO_SAVE_DELAY)
  }
  function flushSave(nextSource?: string): Promise<string | null> {
    if (pendingSave.current) {
      clearTimeout(pendingSave.current)
      pendingSave.current = null
    }
    if (nextSource !== undefined) editState.current.source = nextSource
    return save()
  }

  function cancelPendingSave() {
    if (pendingSave.current) {
      clearTimeout(pendingSave.current)
      pendingSave.current = null
    }
  }

  async function resolveConflict(overwrite: boolean) {
    if (!active || !alive.current) return
    cancelPendingSave()
    setError(null)
    try {
      const disk = await readNote(editState.current.savedNote)
      if (!alive.current) return
      if (overwrite) {
        const saved = await saveNote(disk, editState.current.source)
        if (!alive.current) return
        editState.current.savedNote = saved
        setSavedNote(saved)
        onSave(saved)
      } else {
        editState.current.savedNote = disk
        editState.current.source = disk.source
        setSavedNote(disk)
        setSource(disk.source)
        onSave(disk)
      }
    } catch (cause) {
      if (alive.current) setError(errorText(cause))
    }
  }
  async function share() {
    if (!active || opening || sharing) return
    const epoch = ++shareEpoch.current
    const current = () => alive.current && shareEpoch.current === epoch
    setSharing(true)
    setError(null)
    try {
      if (!(await Sharing.isAvailableAsync()))
        throw new Error('Sharing is not available on this device.')
      if (mode === 'source') {
        const uri = await prepareSource(savedNote, source)
        if (current())
          await Sharing.shareAsync(uri, {
            mimeType: 'text/plain',
            dialogTitle: savedNote.title,
            UTI: 'public.plain-text',
          })
      } else {
        const preview = await autoPdf.current()
        if (!current()) return
        const uri = await preparePdf({ ...savedNote, pdfUri: preview.uri })
        if (current())
          await Sharing.shareAsync(uri, {
            mimeType: 'application/pdf',
            dialogTitle: savedNote.title,
            UTI: 'com.adobe.pdf',
          })
      }
    } catch (cause) {
      if (current()) setError(errorText(cause))
    } finally {
      if (current()) setSharing(false)
    }
  }
  async function openNativePdf() {
    if (!active || opening || openingPdf || sharing) return
    const epoch = ++shareEpoch.current
    const current = () => alive.current && shareEpoch.current === epoch
    setOpeningPdf(true)
    setError(null)
    try {
      const preview = await autoPdf.current()
      if (!current()) return
      const uri = await preparePdf({ ...savedNote, pdfUri: preview.uri })
      if (!current()) return
      if (Platform.OS === 'android') {
        const content = await FileSystem.getContentUriAsync(uri)
        try {
          await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
            data: content,
            type: 'application/pdf',
            flags: 1,
          })
        } catch {
          if (!(await Sharing.isAvailableAsync()))
            throw new Error('No PDF app is installed and sharing is not available.')
          await Sharing.shareAsync(uri, {
            mimeType: 'application/pdf',
            dialogTitle: savedNote.title,
            UTI: 'com.adobe.pdf',
          })
        }
      } else {
        if (!(await Sharing.isAvailableAsync()))
          throw new Error('Opening PDFs is not available on this device.')
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: savedNote.title,
          UTI: 'com.adobe.pdf',
        })
      }
    } catch (cause) {
      if (current()) setError(errorText(cause))
    } finally {
      if (current()) setOpeningPdf(false)
    }
  }
  function closeFind() {
    setSelection(undefined)
    setFindOpen(false)
    setFocusFind(false)
    Keyboard.dismiss()
    editor.current?.blur()
  }
  function changeFind(value: string) {
    setFind(value)
    setMatchIndex(0)
    const selection = findFirst(source, value)
    setSelection(selection)
  }
  function moveMatch(direction: number) {
    if (!matches.length) return
    const next =
      (Math.min(matchIndex, matches.length - 1) + direction + matches.length) % matches.length
    setMatchIndex(next)
    setSelection({ start: matches[next], end: matches[next] + find.length })
  }

  // Back leaves Find before editing before the note, so the current step always closes first
  // instead of the note closing.
  function leave(fromEditor = editing) {
    if (findOpen) {
      closeFind()
      return
    }
    if (!fromEditor && !Keyboard.isVisible()) {
      dismiss.current()
      return
    }
    editor.current?.blur()
    Keyboard.dismiss()
  }

  // Show whatever PDF already exists instead of waiting for the next compile.
  const pdfUri = autoPdf.preview?.uri ?? null
  const pdfSource = useMemo(() => (pdfUri ? { uri: pdfUri } : null), [pdfUri])
  const compileError = autoPdf.error
  const issues = autoPdf.diagnostics
  const bannerMessage = error || openError || autoPdf.storageError || ''
  const bannerConflict = isSyncConflict(bannerMessage)
  const conflictActions = bannerConflict
    ? [
        { label: 'Reload from disk', onPress: () => void resolveConflict(false) },
        { label: 'Overwrite', onPress: () => void resolveConflict(true) },
      ]
    : undefined
  const compileConflict = isSyncConflict(compileError)
  // Only the open note can be underlined. Issues from imports still show their
  // file in the popup, so pass them through with their path.
  const editorIssues = useMemo(
    () =>
      issues.map((issue) =>
        issue.path === savedNote.path
          ? {
              line: issue.line,
              column: issue.column,
              severity: issue.severity,
              message: issue.message,
            }
          : {
              line: issue.line,
              column: issue.column,
              severity: issue.severity,
              message: issue.message,
              path: issue.path,
            }
      ),
    [issues, savedNote.path]
  )
  const revealIndex = Math.max(
    0,
    issues.findIndex((issue) => issue.severity === 'error')
  )
  const firstIssue = issues[revealIndex]
  const failureHint =
    firstIssue?.severity === 'error'
      ? firstIssue.path === savedNote.path
        ? 'Check the source for the error.'
        : `The error is in ${firstIssue.path}, line ${firstIssue.line}.`
      : compileError
  const warningHint = issues
    .filter((issue) => issue.severity !== 'error')
    .map((issue) => issue.message)
    .join('\n')
  // In PDF mode the viewer also mounts before the first compile, so it can show the spinner
  // and have its webview booted by the time the PDF is ready.
  const showPdf = !pdfError && (!!autoPdf.preview || (mode === 'pdf' && !autoPdf.error))
  // A failure covers the page it replaced, so it rises over it instead of
  // appearing whole. A failure found while the source is open plays the rise
  // when the PDF is opened, not off-screen.
  const failureVisible = !!compileError && !pdfError && mode === 'pdf'
  const failureReveal = useSharedValue(0)
  useEffect(() => {
    if (!failureVisible) return
    failureReveal.value = 0
    failureReveal.value = timing(1, { duration: 200 })
  }, [failureReveal, failureVisible])
  const failureMotion = useAnimatedStyle(() => ({
    opacity: failureReveal.value,
    transform: [{ translateY: (1 - failureReveal.value) * 8 }],
  }))

  return (
    <Screen
      onClose={close}
      onRequestClose={() => leave()}
      onDismissStart={() => {
        shareEpoch.current++
        setSharing(false)
        void flushSave()
      }}
      visible={active}
      instantIn={instantIn}
      swipeBack
      dismissOnSwipe={!editing && !findOpen}
      dismissRef={dismiss}
    >
      <View style={s.screen}>
        {/* Android does not resize the window for the keyboard, so pad on both
            platforms. The offset is this screen's top safe-area padding. */}
        <KeyboardAvoidingView
          style={s.flex}
          enabled={active}
          behavior={keyboardBehavior}
          keyboardVerticalOffset={top}
        >
          {(error || openError || autoPdf.storageError) && (
            <View style={s.errorInset}>
              <ErrorBanner
                message={bannerMessage}
                onDismiss={error ? () => setError(null) : undefined}
                actions={conflictActions}
              />
            </View>
          )}
          <View
            style={[s.flex, s.contentClip]}
            onLayout={(event) => setContentWidth(event.nativeEvent.layout.width)}
          >
            <Reanimated.View
              style={[s.flex, sourceSlide]}
              pointerEvents={mode === 'source' ? 'auto' : 'none'}
              accessibilityElementsHidden={mode !== 'source'}
              importantForAccessibility={mode === 'source' ? 'auto' : 'no-hide-descendants'}
            >
              {isRootTemplate(savedNote.path) && (
                <TemplateHint
                  onInsert={(placeholder) => editor.current?.insert(placeholder)}
                  disabled={opening}
                />
              )}
              <SourceEditor
                ref={editor}
                documentId={documentId}
                value={source}
                issues={editorIssues}
                onChangeText={(text) => {
                  setSource(text)
                  setSelection(undefined)
                  scheduleSave()
                }}
                selection={selection}
                editable={active && mode === 'source' && !opening}
                waitForKeyboardHide={!findOpen}
                onPainted={() => onPrepared(session)}
                onFocusChange={setEditing}
                onError={(message, fatal = true) => {
                  setError(message)
                  if (fatal) onPrepared(session)
                }}
                onSave={(text) => void flushSave(text)}
                onBack={leave}
              />
            </Reanimated.View>
            <Reanimated.View
              style={[StyleSheet.absoluteFill, pdfSlide, { opacity: contentWidth ? 1 : 0 }]}
              pointerEvents={mode === 'pdf' ? 'auto' : 'none'}
              accessibilityElementsHidden={mode !== 'pdf'}
              importantForAccessibility={mode === 'pdf' ? 'auto' : 'no-hide-descendants'}
            >
              {pdfError && (
                <View style={s.errorInset}>
                  <ErrorBanner title="PDF viewer failed" message={pdfError} />
                  <Action
                    label="Retry PDF"
                    onPress={() => {
                      setPdfError(null)
                      setPdfReloadEpoch((value) => value + 1)
                      autoPdf.retry()
                    }}
                  />
                </View>
              )}
              {showPdf ? (
                <Pdf
                  source={pdfSource}
                  style={s.pdf}
                  reloadEpoch={pdfReloadEpoch}
                  onError={(cause) => setPdfError(errorText(cause))}
                />
              ) : null}
              {compileError && !pdfError ? (
                <Reanimated.View
                  accessibilityRole="alert"
                  accessibilityLiveRegion="polite"
                  style={[s.pdfFailure, failureMotion]}
                >
                  <Icon name="alert" size={30} color={colors.coral} />
                  <Text style={s.pdfFailureTitle}>PDF compilation failed</Text>
                  <Text numberOfLines={8} style={s.pdfFailureText}>
                    {failureHint}
                  </Text>
                  {warningHint ? (
                    <Text numberOfLines={4} style={s.pdfFailureText}>
                      {warningHint}
                    </Text>
                  ) : null}
                  <Action
                    label="Retry"
                    onPress={() => {
                      setPdfReloadEpoch((value) => value + 1)
                      autoPdf.retry()
                    }}
                  />
                  {issues.length > 0 && (
                    <Action
                      label="Check source"
                      onPress={() => {
                        switchMode('source')
                        // Let the source view become visible before revealing the error.
                        setTimeout(() => editor.current?.revealIssue(revealIndex), 50)
                      }}
                    />
                  )}
                  {compileConflict && (
                    <>
                      <Action
                        label="Reload from disk"
                        onPress={() => void resolveConflict(false)}
                      />
                      <Action label="Overwrite" onPress={() => void resolveConflict(true)} />
                    </>
                  )}
                </Reanimated.View>
              ) : null}
            </Reanimated.View>
            <View pointerEvents="none" style={s.noteContentFade}>
              <Fade id="note-content-fade" color={colors.paper} mid={0.15} />
            </View>
          </View>
          <View style={s.noteDockShell}>
            <View style={s.noteDock}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={findOpen ? 'Close find' : 'Close note'}
                onPress={() => (findOpen ? closeFind() : dismiss.current())}
                style={({ pressed }) => [s.barButton, pressed && s.pressed]}
              >
                <Icon name="close" size={24} color={colors.ink} />
              </Pressable>
              {/* One track, two bars: the mode bar and the find field, so the
                  field slides in over the buttons instead of squeezing them. */}
              <View
                style={s.noteBarArea}
                onLayout={(event) => setBarArea(event.nativeEvent.layout.width)}
              >
                <Reanimated.View style={[s.noteBarTrack, barTrackStyle]}>
                  <View
                    style={[s.noteBarPanel, { width: barArea || '100%' }]}
                    pointerEvents={findOpen ? 'none' : 'auto'}
                    accessibilityElementsHidden={findOpen}
                    importantForAccessibility={findOpen ? 'no-hide-descendants' : 'auto'}
                  >
                    <PillTabs
                      options={NOTE_MODE_OPTIONS}
                      value={mode}
                      onSelect={switchMode}
                      style={s.noteSegments}
                      itemStyle={s.noteSegment}
                      textStyle={s.noteSegmentText}
                      pillStyle={{ backgroundColor: colors.accent, borderRadius: 19 }}
                      inset={5}
                      activeColor={colors.onAccent}
                      idleColor={colors.ink}
                    />
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={
                        mode === 'pdf' ? 'Open PDF in the device viewer' : 'Find in note'
                      }
                      disabled={mode === 'pdf' && (openingPdf || !!autoPdf.error || !!pdfError)}
                      onPress={() => {
                        if (mode === 'pdf') {
                          void openNativePdf()
                          return
                        }
                        editor.current?.blur()
                        setFocusFind(true)
                        setFindOpen(true)
                      }}
                      style={({ pressed }) => [
                        s.barButton,
                        pressed && s.pressed,
                        mode === 'pdf' &&
                          (openingPdf || !!autoPdf.error || !!pdfError) &&
                          s.disabled,
                      ]}
                    >
                      <IconFade
                        from="search"
                        to="maximize"
                        swapped={mode === 'pdf'}
                        size={24}
                        color={colors.ink}
                      />
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={mode === 'source' ? 'Share Typst source' : 'Share PDF'}
                      disabled={
                        opening || sharing || (mode === 'pdf' && (!!autoPdf.error || !!pdfError))
                      }
                      onPress={() => void share()}
                      style={({ pressed }) => [
                        s.barButton,
                        pressed && s.pressed,
                        (opening ||
                          sharing ||
                          (mode === 'pdf' && (!!autoPdf.error || !!pdfError))) &&
                          s.disabled,
                      ]}
                    >
                      <Icon name="share" size={22} color={colors.ink} />
                    </Pressable>
                  </View>
                  <View
                    style={[s.noteBarPanel, { width: barArea || '100%' }]}
                    pointerEvents={findOpen ? 'auto' : 'none'}
                    accessibilityElementsHidden={!findOpen}
                    importantForAccessibility={findOpen ? 'auto' : 'no-hide-descendants'}
                  >
                    <View style={s.findDock}>
                      <Icon name="search" size={20} color={colors.accent} />
                      <TextInput
                        ref={findInput}
                        accessibilityLabel="Find in source"
                        autoFocus={focusFind}
                        selectTextOnFocus
                        placeholder="Find in this note"
                        placeholderTextColor={colors.muted}
                        value={find}
                        onChangeText={changeFind}
                        style={s.findDockInput}
                        autoCorrect={false}
                        autoCapitalize="none"
                        returnKeyType="search"
                        onSubmitEditing={() => moveMatch(1)}
                      />
                      <Ticker current={matchCurrent} total={matchCount} style={s.findDockCount} />
                      <IconButton
                        name="chevronUp"
                        label="Previous match"
                        onPress={() => moveMatch(-1)}
                        disabled={!matches.length}
                      />
                      <IconButton
                        name="chevronDown"
                        label="Next match"
                        onPress={() => moveMatch(1)}
                        disabled={!matches.length}
                      />
                    </View>
                  </View>
                </Reanimated.View>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Screen>
  )
}

function TemplateHint({
  onInsert,
  disabled = false,
}: {
  onInsert: (placeholder: string) => void
  disabled?: boolean
}) {
  const s = useStyles()
  return (
    <View style={s.templateHint}>
      <Text style={s.templateHintText}>New notes start from template.typ.</Text>
      {[
        ['{{title}}', 'becomes the note title'],
        ['{{body}}', 'becomes the note body'],
      ].map(([placeholder, hint]) => (
        <View key={placeholder} style={s.placeholderRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Insert ${placeholder}`}
            disabled={disabled}
            onPress={() => onInsert(placeholder)}
            style={({ pressed }) => [
              s.placeholderChip,
              pressed && s.rowPressed,
              disabled && s.disabled,
            ]}
          >
            <Text style={s.placeholderText}>{placeholder}</Text>
          </Pressable>
          <Text style={s.placeholderHint}>{hint}</Text>
        </View>
      ))}
    </View>
  )
}
