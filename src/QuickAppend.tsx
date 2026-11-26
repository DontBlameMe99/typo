import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  AppState,
  Keyboard,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native'
import { listHeadings } from './append'
import { ErrorBanner } from './ErrorBanner'
import {
  type QuickAppendTarget,
  quickAppendLabel,
  readQuickAppendTarget,
} from './quick-append-config'
import { finishQuickNote } from './quick-note-native'
import {
  QuickSheetRoot,
  QuickToolbar,
  quickErrorText,
  useQuickFormStyles,
  useQuickSheet,
  useQuickStyles,
} from './quick-sheet'
import { useTheme } from './theme'
import type { Note, Vault } from './types'
import { appendToNoteAtPath, readNoteAtPath, readSavedVault } from './vault'

export default function QuickAppendRoot() {
  return (
    <QuickSheetRoot>
      <QuickAppend />
    </QuickSheetRoot>
  )
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; vault: Vault; target: QuickAppendTarget; note: Note }
  | { kind: 'missing'; message: string }
  | { kind: 'error'; message: string }

function QuickAppend() {
  const { colors, ready } = useTheme()
  const s = useQuickStyles()
  const f = useQuickFormStyles(220)
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    void (async () => {
      try {
        const vault = await readSavedVault()
        if (!alive.current) return
        if (!vault) {
          setState({ kind: 'missing', message: 'Choose a notes folder in Typo first.' })
          return
        }
        const target = readQuickAppendTarget()
        if (!target) {
          setState({
            kind: 'missing',
            message: 'Choose a quick append target in Typo settings first.',
          })
          return
        }
        if (target.vaultUri !== vault.uri) {
          setState({
            kind: 'missing',
            message: 'The quick append target belongs to another folder. Choose it again in Typo.',
          })
          return
        }
        const note = await readNoteAtPath(vault, target.notePath)
        if (!alive.current) return
        const matches = listHeadings(note.source).filter(
          (heading) => heading.text === target.section
        )
        if (matches.length !== 1) {
          setState({
            kind: 'error',
            message:
              matches.length === 0
                ? `The section "${target.section}" was not found. Choose the target again in Typo.`
                : `More than one "${target.section}" section exists. Choose a clear target in Typo.`,
          })
          return
        }
        setState({ kind: 'ready', vault, target, note })
      } catch (cause) {
        if (alive.current)
          setState({
            kind: 'error',
            message: quickErrorText(cause, 'Could not append to the note.'),
          })
      }
    })()
    return () => {
      alive.current = false
    }
  }, [])

  const close = useCallback(() => {
    Keyboard.dismiss()
    finishQuickNote()
  }, [])
  useQuickSheet(close, saving)

  async function append() {
    if (state.kind !== 'ready' || !text.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      await appendToNoteAtPath(state.vault, state.target.notePath, state.target.section, text)
      if (alive.current) close()
    } catch (cause) {
      if (!alive.current) return
      if (AppState.currentState !== 'active') {
        finishQuickNote()
        return
      }
      setError(quickErrorText(cause, 'Could not append to the note.'))
      setSaving(false)
    }
  }

  const canAppend = state.kind === 'ready' && !!text.trim() && !saving

  if (!ready) return null

  return (
    <KeyboardAvoidingView style={s.root} behavior="padding">
      <View style={s.backdrop}>
        <View style={s.card}>
          <QuickToolbar
            title="Append note"
            actionLabel="Append"
            busyLabel="Appending…"
            canSubmit={canAppend}
            saving={saving}
            closeLabel="Close quick append"
            actionAccessibilityLabel="Append to note"
            onClose={close}
            onSubmit={() => void append()}
          />
          {state.kind === 'loading' ? (
            <View style={s.center}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : state.kind === 'missing' || state.kind === 'error' ? (
            <View style={s.center}>
              <Text style={s.notice}>{state.message}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={close}
                style={({ pressed }) => [s.noticeButton, pressed && s.pressed]}
              >
                <Text style={s.noticeButtonText}>Close</Text>
              </Pressable>
            </View>
          ) : (
            <ScrollView
              style={s.flex}
              contentContainerStyle={f.form}
              keyboardShouldPersistTaps="handled"
            >
              {error && (
                <View style={s.errorInset}>
                  <ErrorBanner message={error} onDismiss={() => setError(null)} />
                </View>
              )}
              <View style={f.target}>
                <Text numberOfLines={1} style={f.targetText}>
                  {quickAppendLabel(state.target)}
                </Text>
              </View>
              <TextInput
                accessibilityLabel="Quick append text"
                placeholder="Write a quick note…"
                placeholderTextColor={colors.muted}
                value={text}
                onChangeText={(value) => {
                  setText(value)
                  setError(null)
                }}
                editable={!saving}
                autoFocus
                multiline
                textAlignVertical="top"
                cursorColor={colors.accent}
                style={f.body}
              />
            </ScrollView>
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  )
}
