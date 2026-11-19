import { useEffect, useMemo, useRef, useState } from 'react'
import { Keyboard, KeyboardAvoidingView, Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ErrorBanner } from '../ErrorBanner'
import { Icon } from '../icons'
import { SourceEditor, type SourceEditorHandle } from '../SourceEditor'
import { useTheme } from '../theme'
import type { Vault } from '../types'
import { saveTemplate } from '../vault'
import { errorText, keyboardBehavior } from './shared'
import { useStyles } from './styles'
import { ConfirmDialog, Screen } from './ui'

// Mirrors `.cm-template .cm-scroller` in src/editor/web.ts.
const TEMPLATE_LINE_HEIGHT = 28
const TEMPLATE_CONTENT_TOP = 16

type TemplateProblem = {
  name: string
  from: number
  to: number
  line: number
  column: number
}

function templateProblems(source: string): TemplateProblem[] {
  const problems: TemplateProblem[] = []
  for (const match of source.matchAll(/\{\{([^{}]*)\}\}/gu)) {
    const name = match[1].trim()
    if (name === 'title' || name === 'body') continue
    const from = match.index ?? 0
    const lineStart = source.lastIndexOf('\n', Math.max(0, from - 1)) + 1
    const inside = source.slice(from + 2, from + match[0].length - 2)
    const leading = inside.length - inside.trimStart().length
    problems.push({
      name,
      from,
      to: from + match[0].length,
      line: source.slice(0, from).split('\n').length,
      column: from - lineStart + 3 + leading,
    })
  }
  return problems
}

export function TemplateEditor({
  vault,
  source,
  onClose,
  onSaved,
}: {
  vault: Vault
  source: string
  onClose: () => void
  onSaved: (source: string) => void
}) {
  const s = useStyles()
  const { colors } = useTheme()
  const { top, bottom } = useSafeAreaInsets()
  const [current, setCurrent] = useState(source)
  const saved = source
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)
  const [editorHeight, setEditorHeight] = useState(0)
  const [cardHeight, setCardHeight] = useState(0)
  const editor = useRef<SourceEditorHandle>(null)
  const alive = useRef(true)
  const dismiss = useRef<(after?: () => void) => void>(() => {})
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const dirty = current !== saved
  const problems = useMemo(() => templateProblems(current), [current])
  const issues = useMemo(
    () =>
      problems.map((problem) => ({
        line: problem.line,
        column: problem.column,
        severity: 'error' as const,
        message: `Unknown placeholder {{${problem.name}}}.`,
      })),
    [problems]
  )
  const canSave = !saving && dirty && problems.length === 0
  const card = selected === null ? undefined : problems[selected]
  const wantedTop = card
    ? TEMPLATE_CONTENT_TOP +
      (card.line - 1) * TEMPLATE_LINE_HEIGHT +
      TEMPLATE_LINE_HEIGHT +
      (card.line > 4 ? TEMPLATE_LINE_HEIGHT : 0)
    : 0
  const errorTop = card ? Math.min(wantedTop, Math.max(8, editorHeight - cardHeight - 8)) : 0
  const close = () => {
    if (saving) return
    if (confirming) {
      setConfirming(false)
      return
    }
    // Keep the keyboard up while the confirm sheet is open. Dismissing it here
    // makes the editor resize for a frame and flicker before the dialog lands.
    if (dirty) {
      setConfirming(true)
      return
    }
    Keyboard.dismiss()
    dismiss.current()
  }
  async function save(value = current) {
    if (saving || problems.length > 0) return
    setSaving(true)
    setError(null)
    try {
      await saveTemplate(vault, value, saved)
      if (alive.current) dismiss.current(() => onSaved(value))
    } catch (cause) {
      if (alive.current) {
        setError(errorText(cause))
        setSaving(false)
      }
    }
  }
  function applyPlaceholder(name: 'title' | 'body') {
    if (!card) return
    const next = `${current.slice(0, card.from)}{{${name}}}${current.slice(card.to)}`
    setCurrent(next)
    setSelected(null)
    setError(null)
  }
  return (
    <Screen onClose={onClose} onRequestClose={close} insets={false} dismissRef={dismiss}>
      <View style={[s.screen, { paddingTop: top + 8, paddingBottom: bottom }]}>
        <KeyboardAvoidingView
          style={s.flex}
          importantForAccessibility={confirming ? 'no-hide-descendants' : 'auto'}
          behavior={keyboardBehavior}
          keyboardVerticalOffset={top}
        >
          {error && (
            <View style={s.errorInset}>
              <ErrorBanner message={error} onDismiss={() => setError(null)} />
            </View>
          )}
          <View
            style={s.flex}
            onLayout={(event) => setEditorHeight(event.nativeEvent.layout.height)}
          >
            <SourceEditor
              ref={editor}
              documentId="template"
              value={current}
              issues={issues}
              template
              onChangeText={(text) => {
                setCurrent(text)
                setSelected(null)
              }}
              onIssuePress={(index) => setSelected(index < 0 ? null : index)}
              editable={!saving}
              waitForKeyboardHide={false}
              onPainted={() => {}}
              onFocusChange={() => {}}
              onError={(message) => setError(message)}
              onSave={(value) => void save(value)}
              onBack={close}
            />
            {card ? (
              <View
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
                onLayout={(event) => setCardHeight(event.nativeEvent.layout.height)}
                style={[s.templateErrorCard, { top: errorTop }]}
              >
                <View style={s.templateErrorHeader}>
                  <Icon name="alert" size={20} color={colors.coral} />
                  <Text style={s.templateErrorText}>
                    Unknown placeholder {`{{${card.name}}}`}. Only {'{{title}}'} and {'{{body}}'}{' '}
                    work here.
                  </Text>
                </View>
                <View style={s.templateErrorActions}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => applyPlaceholder('title')}
                    style={({ pressed }) => [s.templateErrorButton, pressed && s.pressed]}
                  >
                    <Text style={s.templateErrorButtonText}>{'Use {{title}}'}</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => applyPlaceholder('body')}
                    style={({ pressed }) => [s.templateErrorButton, pressed && s.pressed]}
                  >
                    <Text style={s.templateErrorButtonText}>{'Use {{body}}'}</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
          </View>
          <View style={s.barShell}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close template editor"
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
            <View style={s.templatePills}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Insert title placeholder"
                disabled={saving}
                onPress={() => editor.current?.insert('{{title}}')}
                style={({ pressed }) => [s.templatePill, pressed && s.pressed]}
              >
                <Text numberOfLines={1} style={s.templatePillText}>
                  {'{{title}}'}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Insert body placeholder"
                disabled={saving}
                onPress={() => editor.current?.insert('{{body}}')}
                style={({ pressed }) => [s.templatePill, pressed && s.pressed]}
              >
                <Text numberOfLines={1} style={s.templatePillText}>
                  {'{{body}}'}
                </Text>
              </Pressable>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save template"
              disabled={!canSave}
              onPress={() => void save()}
              style={({ pressed }) => [
                s.barButton,
                s.barButtonFloating,
                s.barPrimary,
                pressed && s.pressed,
                !canSave && s.barPrimaryDisabled,
              ]}
            >
              <Icon name="check" size={24} color={canSave ? colors.onAccent : colors.muted} />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
        <ConfirmDialog
          visible={confirming}
          local
          title="Discard template changes?"
          message="Your template changes haven’t been saved."
          confirmLabel="Discard changes"
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false)
            Keyboard.dismiss()
            dismiss.current()
          }}
        />
      </View>
    </Screen>
  )
}
