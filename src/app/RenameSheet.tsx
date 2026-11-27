import { useState } from 'react'
import { Keyboard, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { ErrorBanner } from '../ErrorBanner'
import { Icon } from '../icons'
import { useTheme } from '../theme'
import { errorText } from './shared'
import { useStyles } from './styles'
import { BottomSheet } from './ui'

export function RenameSheet({
  name,
  kind,
  onConfirm,
  onClose,
}: {
  name: string
  kind: 'note' | 'folder'
  onConfirm: (name: string) => Promise<void>
  onClose: () => void
}) {
  const s = useStyles()
  const { colors } = useTheme()
  const [value, setValue] = useState(name)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const changed = value.trim().normalize('NFC') !== name

  async function confirm() {
    if (busy || !changed) return
    Keyboard.dismiss()
    setBusy(true)
    setError(null)
    try {
      await onConfirm(value.trim())
    } catch (cause) {
      setError(errorText(cause))
      setBusy(false)
    }
  }

  return (
    <BottomSheet
      title={`Rename ${kind}`}
      onClose={onClose}
      busy={busy}
      onRequestClose={() => false}
      cardStyle={{ backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.line }}
      trailing={
        <View style={s.moveFilePill}>
          <Icon name={kind === 'note' ? 'file' : 'folder'} size={16} color={colors.muted} />
          <Text numberOfLines={1} style={s.moveFilePillText}>
            {name}
          </Text>
        </View>
      }
    >
      <ScrollView
        style={s.moveScroll}
        contentContainerStyle={s.moveScrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={s.moveNewInputRow}>
          <Icon name={kind === 'note' ? 'file' : 'folder'} size={20} color={colors.accent} />
          <TextInput
            accessibilityLabel={`New ${kind} name`}
            value={value}
            onChangeText={(next) => {
              setValue(next)
              setError(null)
            }}
            editable={!busy}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={200}
            placeholder="Name"
            placeholderTextColor={colors.muted}
            returnKeyType="done"
            onSubmitEditing={() => void confirm()}
            cursorColor={colors.accent}
            style={s.moveNewInput}
          />
        </View>
        <Text style={s.moveHint}>The new name stays in the same folder.</Text>
        {error ? (
          <View style={s.sheetError}>
            <ErrorBanner message={error} onDismiss={() => setError(null)} />
          </View>
        ) : null}
      </ScrollView>
      <PressableConfirm
        busy={busy || !changed}
        label={`Rename ${kind}`}
        onPress={() => void confirm()}
      />
    </BottomSheet>
  )
}

function PressableConfirm({
  busy,
  label,
  onPress,
}: {
  busy: boolean
  label: string
  onPress: () => void
}) {
  const s = useStyles()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [s.moveButton, pressed && s.pressed, busy && s.moveButtonDisabled]}
    >
      <Text style={[s.moveButtonText, busy && s.moveButtonTextDisabled]}>{label}</Text>
    </Pressable>
  )
}
