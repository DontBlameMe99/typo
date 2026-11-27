import { useCallback, useEffect, useState } from 'react'
import { Alert, Pressable, ScrollView, Text, View } from 'react-native'
import { ErrorBanner } from '../ErrorBanner'
import { Icon } from '../icons'
import { useTheme } from '../theme'
import type { Vault } from '../types'
import { errorText } from './shared'
import { useStyles } from './styles'
import { emptyTrash, listTrashedItems, type TrashedItem } from './trash'
import { BottomSheet } from './ui'

export function TrashSheet({
  vault,
  onRestore,
  onEmpty,
  onClose,
}: {
  vault: Vault
  onRestore: (item: TrashedItem) => Promise<void>
  onEmpty: () => Promise<void>
  onClose: () => void
}) {
  const s = useStyles()
  const { colors } = useTheme()
  const [items, setItems] = useState<TrashedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      setItems(await listTrashedItems(vault))
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setLoading(false)
    }
  }, [vault])

  useEffect(() => {
    void reload()
  }, [reload])

  async function restore(item: TrashedItem) {
    setBusy(true)
    setError(null)
    try {
      await onRestore(item)
      await reload()
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setBusy(false)
    }
  }

  function clear() {
    if (!items.length) return
    Alert.alert(
      'Empty trash?',
      `Remove ${items.length} item${items.length === 1 ? '' : 's'} permanently?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Empty trash',
          style: 'destructive',
          onPress: () => {
            setBusy(true)
            setError(null)
            void emptyTrash(vault)
              .then(async () => {
                await onEmpty()
                await reload()
              })
              .catch((cause: unknown) => setError(errorText(cause)))
              .finally(() => setBusy(false))
          },
        },
      ]
    )
  }

  return (
    <BottomSheet
      title="Trash"
      onClose={onClose}
      busy={busy}
      onRequestClose={() => false}
      cardStyle={{ backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.line }}
    >
      <ScrollView style={s.moveScroll} contentContainerStyle={s.moveScrollContent}>
        {error ? (
          <View style={s.sheetError}>
            <ErrorBanner message={error} onDismiss={() => setError(null)} />
          </View>
        ) : null}
        {loading ? <Text style={s.moveEmpty}>Looking through the trash…</Text> : null}
        {!loading && items.length === 0 ? (
          <Text style={s.moveEmpty}>The trash is empty.</Text>
        ) : null}
        {items.map((item) => (
          <View key={item.path} style={s.moveRow}>
            <View style={s.moveRowIcon}>
              <Icon name={item.directory ? 'folder' : 'file'} size={20} color={colors.accent} />
            </View>
            <View style={s.flex}>
              <Text numberOfLines={1} style={s.moveRowName}>
                {item.name}
              </Text>
              <Text numberOfLines={1} style={s.sheetRowPath}>
                {item.originalPath}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Restore ${item.name}`}
              disabled={busy}
              onPress={() => void restore(item)}
              style={({ pressed }) => [s.iconButton, pressed && s.pressed, busy && s.disabled]}
            >
              <Icon name="arrowUp" size={20} color={colors.accent} />
            </Pressable>
          </View>
        ))}
      </ScrollView>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Empty trash"
        disabled={busy || items.length === 0}
        onPress={clear}
        style={({ pressed }) => [s.moveButton, pressed && s.pressed, busy && s.moveButtonDisabled]}
      >
        <Text style={[s.moveButtonText, busy && s.moveButtonTextDisabled]}>Empty trash</Text>
      </Pressable>
    </BottomSheet>
  )
}
