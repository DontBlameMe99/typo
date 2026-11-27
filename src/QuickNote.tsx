import type * as React from 'react'
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
import { ErrorBanner } from './ErrorBanner'
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
import type { Vault } from './types'
import { createNote, readSavedVault, readTemplate } from './vault'

export default function QuickNoteRoot() {
  return (
    <QuickSheetRoot>
      <QuickNote />
    </QuickSheetRoot>
  )
}

type VaultState =
  | { kind: 'loading' }
  | { kind: 'ready'; vault: Vault }
  | { kind: 'missing' }
  | { kind: 'error'; message: string }

type TemplateResult = { source: string } | { error: unknown }

function QuickNote() {
  const { colors, ready } = useTheme()
  const s = useQuickStyles()
  const f = useQuickFormStyles(180)
  const [state, setState] = useState<VaultState>({ kind: 'loading' })
  const {
    draft,
    update: updateDraft,
    clear: clearDraft,
    pending: pendingDraft,
  } = useQuickDraft('note')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bodyRef = useRef<React.ComponentRef<typeof TextInput>>(null)
  const template = useRef<Promise<TemplateResult> | null>(null)
  const alive = useRef(true)
  const pendingSave = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    alive.current = true
    void (async () => {
      try {
        const vault = await readSavedVault()
        if (!alive.current) return
        if (!vault) {
          setState({ kind: 'missing' })
          return
        }
        // Start the template read now. The form does not wait for it, so the
        // first frame never sits on a SAF round trip.
        template.current = readTemplate(vault).then(
          (source) => ({ source }),
          (cause) => ({ error: cause })
        )
        setState({ kind: 'ready', vault })
      } catch (cause) {
        if (alive.current)
          setState({ kind: 'error', message: quickErrorText(cause, 'Could not create the note.') })
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
  async function create() {
    const title = draft.title?.trim() ?? ''
    if (state.kind !== 'ready' || !title || saving) return
    setSaving(true)
    setError(null)
    const save = (async () => {
      const pending = template.current
      if (!pending) throw new Error('The note template is unavailable.')
      const result = await pending
      if ('error' in result) throw result.error
      await createNote(state.vault, title, draft.body ?? '', '', result.source)
      await clearDraft()
    })()
    pendingSave.current = save.catch(() => {})
    try {
      await save
      if (alive.current) await close()
    } catch (cause) {
      if (!alive.current) return
      // The error is only safe to keep on screen while the sheet is in front.
      if (AppState.currentState !== 'active') {
        await close()
        return
      }
      setError(quickErrorText(cause, 'Could not create the note.'))
      setSaving(false)
    }
  }

  const canCreate = state.kind === 'ready' && !!draft.title?.trim() && !saving

  if (!ready) return null

  return (
    <KeyboardAvoidingView style={s.root} behavior="padding">
      <View style={s.backdrop}>
        <View style={s.card}>
          <QuickToolbar
            title="New note"
            actionLabel="Create"
            busyLabel="Creating…"
            canSubmit={canCreate}
            saving={saving}
            closeLabel="Close quick note"
            actionAccessibilityLabel="Create note"
            onClose={close}
            onSubmit={() => void create()}
          />

          {state.kind === 'loading' ? (
            <View style={s.center}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : state.kind === 'missing' || state.kind === 'error' ? (
            <View style={s.center}>
              <Text style={s.notice}>
                {state.kind === 'missing' ? 'Choose a notes folder in Typo first.' : state.message}
              </Text>
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
              <TextInput
                accessibilityLabel="Note title"
                placeholder="Give it a title"
                placeholderTextColor={colors.muted}
                value={draft.title ?? ''}
                onChangeText={(value) => {
                  updateDraft({ title: value })
                  setError(null)
                }}
                editable={!saving}
                autoFocus
                maxLength={180}
                cursorColor={colors.accent}
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={() => bodyRef.current?.focus()}
                style={f.title}
              />
              <View style={f.divider} />
              <TextInput
                ref={bodyRef}
                accessibilityLabel="Note body"
                placeholder="Start anywhere. A sentence, a thought, a possibility…"
                placeholderTextColor={colors.muted}
                value={draft.body ?? ''}
                onChangeText={(value) => {
                  updateDraft({ body: value })
                  setError(null)
                }}
                editable={!saving}
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
