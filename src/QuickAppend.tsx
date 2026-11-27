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
import { appendToSection, headingMatches, listHeadings } from './append'
import { ErrorBanner } from './ErrorBanner'
import { loadVaultIndexSync } from './library-cache'
import {
  type QuickAppendTarget,
  quickAppendLabel,
  readQuickAppendTarget,
  storeQuickAppendTarget,
} from './quick-append-config'
import { finishQuickNote } from './quick-note-native'
import {
  QuickSheetRoot,
  QuickToolbar,
  quickErrorText,
  useQuickDraft,
  useQuickFormStyles,
  useQuickSheet,
  useQuickStyles,
} from './quick-sheet'
import { useTheme } from './theme'
import type { Note, Vault } from './types'
import { readNote, readNoteAtPath, readSavedVault, saveNote } from './vault'

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

async function readTargetNote(vault: Vault, target: QuickAppendTarget): Promise<Note> {
  if (target.noteUri?.startsWith(`${vault.uri}/document/`)) {
    const cached = loadVaultIndexSync(vault)?.notes.find((note) => note.uri === target.noteUri)
    const note = cached ?? {
      uri: target.noteUri,
      path: target.notePath,
      title: '',
      source: '',
      modifiedAt: null,
    }
    try {
      return await readNote(note)
    } catch {
      // The document may have moved; the stored path is the fallback.
    }
  }
  return readNoteAtPath(vault, target.notePath)
}
function QuickAppend() {
  const { colors, ready } = useTheme()
  const s = useQuickStyles()
  const f = useQuickFormStyles(220)
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const {
    draft,
    update: updateDraft,
    clear: clearDraft,
    pending: pendingDraft,
  } = useQuickDraft('append')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const alive = useRef(true)
  const pendingSave = useRef<Promise<void>>(Promise.resolve())

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
        const note = await readTargetNote(vault, target)
        if (!alive.current) return
        const matches = listHeadings(note.source).filter((heading) =>
          headingMatches(heading, { level: target.sectionLevel, text: target.section })
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
        const next = {
          ...target,
          noteUri: note.uri,
          notePath: note.path,
          sectionLevel: target.sectionLevel || matches[0].level,
        }
        if (
          next.noteUri !== target.noteUri ||
          next.notePath !== target.notePath ||
          next.sectionLevel !== target.sectionLevel
        ) {
          void storeQuickAppendTarget(next).catch(() => {})
        }
        setState({ kind: 'ready', vault, target: next, note })
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

  const close = useCallback(async () => {
    Keyboard.dismiss()
    await Promise.all([pendingDraft.current, pendingSave.current])
    finishQuickNote()
  }, [pendingDraft])
  useQuickSheet(close)

  async function append() {
    const text = draft.text ?? ''
    if (state.kind !== 'ready' || !text.trim() || saving) return
    setSaving(true)
    setError(null)
    const save = (async () => {
      const note = await readTargetNote(state.vault, state.target)
      const source = appendToSection(
        note.source,
        { level: state.target.sectionLevel, text: state.target.section },
        text
      )
      await saveNote(note, source)
      await clearDraft()
    })()
    pendingSave.current = save.catch(() => {})
    try {
      await save
      if (alive.current) await close()
    } catch (cause) {
      if (!alive.current) return
      if (AppState.currentState !== 'active') {
        await close()
        return
      }
      setError(quickErrorText(cause, 'Could not append to the note.'))
      setSaving(false)
    }
  }

  const canAppend = state.kind === 'ready' && !!draft.text?.trim() && !saving

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
                value={draft.text ?? ''}
                onChangeText={(value) => {
                  updateDraft({ text: value })
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
