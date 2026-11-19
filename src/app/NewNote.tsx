import { useEffect, useRef, useState } from 'react'
import {
  Keyboard,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ErrorBanner } from '../ErrorBanner'
import { Icon } from '../icons'
import { useTheme } from '../theme'
import type { Note, Vault } from '../types'
import type { NoteFolder } from '../vault'
import { createNote, readTemplate } from '../vault'
import { FolderSheet } from './FolderSheet'
import { errorText, folderName, keyboardBehavior } from './shared'
import { useStyles } from './styles'
import { ConfirmDialog, Screen } from './ui'

export function NewNote({
  vault,
  folders,
  directory,
  initialTemplate,
  onClose,
  onCreated,
  onDismissed,
  onFolderCreated,
  onEditTemplate,
  obscured = false,
}: {
  vault: Vault
  folders: string[]
  directory: string
  initialTemplate?: string
  onClose: () => void
  onCreated: (note: Note) => void
  onDismissed: () => void
  onFolderCreated: (folder: NoteFolder) => void
  onEditTemplate: (source: string, onSaved: (source: string) => void) => void
  obscured?: boolean
}) {
  const s = useStyles()
  const { colors } = useTheme()
  const { top } = useSafeAreaInsets()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const bodyRef = useRef<React.ComponentRef<typeof TextInput>>(null)
  const [destination, setDestination] = useState(directory)
  const [pickingFolder, setPickingFolder] = useState(false)
  const [template, setTemplate] = useState<string | null>(initialTemplate ?? null)
  const [templateLoading, setTemplateLoading] = useState(initialTemplate === undefined)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const alive = useRef(true)
  const dismiss = useRef<(after?: () => void) => void>(() => {})
  useEffect(() => {
    alive.current = true
    if (initialTemplate !== undefined) {
      setTemplate(initialTemplate)
      setTemplateLoading(false)
      return () => {
        alive.current = false
      }
    }
    setTemplate(null)
    setTemplateLoading(true)
    void readTemplate(vault)
      .then((source) => {
        if (alive.current) setTemplate(source)
      })
      .catch((cause: unknown) => {
        if (alive.current) setError(errorText(cause))
      })
      .finally(() => {
        if (alive.current) setTemplateLoading(false)
      })
    return () => {
      alive.current = false
    }
  }, [vault, initialTemplate])
  const canCreate = !saving && !!title.trim() && !templateLoading && template !== null
  const close = () => {
    if (saving) return
    if (confirming) {
      setConfirming(false)
      return
    }
    Keyboard.dismiss()
    if (title || body) setConfirming(true)
    else dismiss.current()
  }
  async function create() {
    if (!title.trim() || saving || template === null) return
    setSaving(true)
    setError(null)
    try {
      const note = await createNote(vault, title.trim(), body, destination, template)
      if (!alive.current) return
      // Put the note in place behind the sheet, then let the sheet slide away
      // over it instead of over the library.
      onCreated(note)
      requestAnimationFrame(() => {
        if (!alive.current) return
        dismiss.current(() => {
          if (alive.current) onDismissed()
        })
      })
    } catch (cause) {
      if (alive.current) {
        setError(errorText(cause))
        setSaving(false)
      }
    }
  }
  return (
    <>
      <Screen onClose={onClose} onRequestClose={close} edge="bottom" dismissRef={dismiss}>
        <View
          style={s.screen}
          accessibilityElementsHidden={pickingFolder || obscured}
          importantForAccessibility={pickingFolder || obscured ? 'no-hide-descendants' : 'auto'}
        >
          {/* Android does not resize the window for the keyboard, so pad on both
              platforms. The offset is this screen's top safe-area padding. */}
          <KeyboardAvoidingView
            style={s.flex}
            importantForAccessibility={confirming ? 'no-hide-descendants' : 'auto'}
            behavior={keyboardBehavior}
            keyboardVerticalOffset={top}
          >
            <ScrollView
              style={s.flex}
              contentContainerStyle={s.newForm}
              keyboardShouldPersistTaps="handled"
            >
              {error && (
                <View style={s.errorInset}>
                  <ErrorBanner message={error} onDismiss={() => setError(null)} />
                </View>
              )}
              <View style={s.newTitleBlock}>
                <TextInput
                  accessibilityLabel="Note title"
                  placeholder="Give it a title"
                  placeholderTextColor={colors.muted}
                  value={title}
                  onChangeText={setTitle}
                  editable={!saving}
                  maxLength={180}
                  style={s.newTitle}
                  cursorColor={colors.accent}
                  returnKeyType="next"
                  submitBehavior="submit"
                  onSubmitEditing={() => bodyRef.current?.focus()}
                />
                <View style={s.newDivider} />
                <TextInput
                  ref={bodyRef}
                  accessibilityLabel="Note body"
                  placeholder="Start anywhere. A sentence, a thought, a possibility…"
                  placeholderTextColor={colors.muted}
                  value={body}
                  onChangeText={setBody}
                  editable={!saving}
                  multiline
                  textAlignVertical="top"
                  cursorColor={colors.accent}
                  style={s.newBody}
                />
              </View>
            </ScrollView>
            <View style={s.barShell}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close new note"
                disabled={saving}
                onPress={close}
                style={({ pressed }) => [
                  s.barButton,
                  s.barButtonFloating,
                  pressed && s.pressed,
                  saving && s.disabled,
                ]}
              >
                <Icon name="close" size={24} color={colors.ink} />
              </Pressable>
              <View style={s.barCenter}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Create in ${destination || vault.name}. Choose folder`}
                  disabled={saving}
                  onPress={() => {
                    Keyboard.dismiss()
                    setPickingFolder(true)
                  }}
                  style={({ pressed }) => [s.barPill, pressed && s.pressed, saving && s.disabled]}
                >
                  <Icon name="folderOpen" size={17} color={colors.muted} />
                  <Text numberOfLines={1} style={s.barPillText}>
                    {destination ? folderName(destination) : vault.name}
                  </Text>
                  <Icon name="chevronDown" size={16} color={colors.muted} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Edit note template"
                  disabled={saving || templateLoading || template === null}
                  onPress={() => {
                    Keyboard.dismiss()
                    if (template !== null) onEditTemplate(template, (source) => setTemplate(source))
                  }}
                  style={({ pressed }) => [
                    s.barPill,
                    s.barPillFixed,
                    pressed && s.pressed,
                    (saving || templateLoading || template === null) && s.disabled,
                  ]}
                >
                  <Icon name="edit" size={16} color={colors.accent} />
                  <Text numberOfLines={1} style={[s.barPillText, s.barPillAction]}>
                    Template
                  </Text>
                </Pressable>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Create note"
                disabled={!canCreate}
                onPress={() => void create()}
                style={({ pressed }) => [
                  s.barButton,
                  s.barButtonFloating,
                  s.barPrimary,
                  pressed && s.pressed,
                  !canCreate && s.barPrimaryDisabled,
                ]}
              >
                <Icon name="check" size={24} color={canCreate ? colors.onAccent : colors.muted} />
              </Pressable>
            </View>
          </KeyboardAvoidingView>
          <ConfirmDialog
            visible={confirming}
            title="Leave unsaved changes?"
            message="Your changes haven’t been saved to the notes folder."
            confirmLabel="Discard changes"
            onCancel={() => setConfirming(false)}
            onConfirm={() => {
              setConfirming(false)
              dismiss.current()
            }}
          />
        </View>
      </Screen>
      {pickingFolder && (
        <FolderSheet
          folders={folders}
          vault={vault}
          initial={destination}
          title="Create in"
          mode="create-in"
          onConfirm={async (path) => {
            setDestination(path)
            setPickingFolder(false)
          }}
          onFolderCreated={onFolderCreated}
          onClose={() => setPickingFolder(false)}
        />
      )}
    </>
  )
}
