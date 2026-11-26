import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ScrollViewInstance } from 'react-native'
import { Keyboard, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import type { NoteSort } from '../core'
import { ErrorBanner } from '../ErrorBanner'
import { Icon, type IconName } from '../icons'
import { useTheme } from '../theme'
import type { Vault } from '../types'
import type { NoteFolder } from '../vault'
import { createFolder } from '../vault'
import {
  allowedFolders,
  folderActionLabel,
  folderChildren,
  folderCrumbs,
  folderPreview,
  newFolderParts,
} from './folder-picker'
import { SwapIcon } from './motion'
import { errorText, folderName, noteSorts } from './shared'
import { useStyles } from './styles'
import { BottomSheet } from './ui'

export function FolderSheet({
  folders,
  vault,
  initial,
  excludeTree,
  defaultParent,
  mode,
  title,
  busyLabel,
  itemName,
  itemIcon = 'file',
  counts,
  onConfirm,
  onClose,
  onFolderCreated,
}: {
  folders: string[]
  vault: Vault
  initial: string | null
  excludeTree?: string
  defaultParent?: string
  mode: 'move' | 'create-in'
  title: string
  busyLabel?: string
  itemName?: string
  itemIcon?: IconName
  counts?: Map<string, number>
  onConfirm: (destination: string) => Promise<void>
  onClose: () => void
  onFolderCreated: (folder: NoteFolder) => void
}) {
  const s = useStyles()
  const { colors } = useTheme()
  const vaultName = vault.name
  const allowed = useMemo(() => allowedFolders(folders, excludeTree), [folders, excludeTree])
  const allowedSet = useMemo(() => new Set(allowed), [allowed])
  const [current, setCurrent] = useState(() => {
    const start = initial ?? defaultParent ?? ''
    return allowedSet.has(start) ? start : ''
  })
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const scroll = useRef<ScrollViewInstance>(null)
  const crumbScroll = useRef<ScrollViewInstance>(null)
  const [error, setError] = useState<string | null>(null)
  // Segments this sheet created, so a retry after a failed move reuses them
  // instead of failing on its own work. Anything else that already exists is
  // a real conflict.
  const createdHere = useRef(new Set<string>())
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  useEffect(() => {
    if (!allowedSet.has(current)) setCurrent('')
  }, [allowedSet, current])
  const children = useMemo(() => folderChildren(allowed, current), [allowed, current])
  const crumbs = useMemo(() => folderCrumbs(current), [current])
  const move = mode === 'move'
  const sameFolder =
    !newFolderOpen && move && defaultParent !== undefined && current === defaultParent
  const chosenName = current ? folderName(current) : vaultName
  const parts = newFolderParts(newName)
  const canCreate = !busy && parts.length > 0
  const actionLabel = folderActionLabel(
    busy,
    busyLabel,
    newFolderOpen,
    move,
    sameFolder,
    current,
    chosenName
  )
  const preview = folderPreview(current, parts)
  const openNewFolder = () => {
    if (busy) return
    setNewFolderOpen(true)
    setNewName('')
    setError(null)
  }
  const closeNewFolder = () => {
    Keyboard.dismiss()
    setNewFolderOpen(false)
    setNewName('')
    setError(null)
    createdHere.current.clear()
  }
  const revealInput = useCallback(() => {
    scroll.current?.scrollToEnd({ animated: true })
  }, [])
  useEffect(() => {
    if (!newFolderOpen) return
    const early = setTimeout(revealInput, 120)
    const settled = setTimeout(revealInput, 420)
    return () => {
      clearTimeout(early)
      clearTimeout(settled)
    }
  }, [newFolderOpen, revealInput])
  useEffect(() => {
    if (!error) return
    const timer = setTimeout(revealInput, 80)
    return () => clearTimeout(timer)
  }, [error, revealInput])
  const navigate = (path: string) => {
    if (busy || path === current) return
    setCurrent(path)
    setNewFolderOpen(false)
    setNewName('')
    setError(null)
    createdHere.current.clear()
  }
  async function confirm() {
    if (busy) return
    if (newFolderOpen) {
      if (!canCreate) return
      setBusy(true)
      setError(null)
      let parent = current
      let createdPath = current
      try {
        for (const [index, name] of parts.entries()) {
          const path = parent ? `${parent}/${name}` : name
          if (createdHere.current.has(path)) {
            parent = path
            createdPath = path
            continue
          }
          if (allowedSet.has(path)) {
            // An existing intermediate folder is the path to nest into. Only
            // the final name is the folder this action was asked to create.
            // Excluded paths never descend: creating them would write inside
            // the tree that is being moved.
            if (index < parts.length - 1) {
              parent = path
              createdPath = path
              continue
            }
            throw new Error(`A folder named "${name}" already exists in "${parent || vault.name}".`)
          }
          const created = await createFolder(vault, name, parent)
          createdHere.current.add(path)
          createdHere.current.add(created.path)
          onFolderCreated(created)
          parent = created.path
          createdPath = created.path
        }
        await onConfirm(createdPath)
      } catch (cause) {
        if (alive.current) {
          setError(errorText(cause))
          setBusy(false)
        }
      }
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onConfirm(current)
    } catch (cause) {
      if (alive.current) {
        setError(errorText(cause))
        setBusy(false)
      }
    }
  }
  return (
    <BottomSheet
      title={title}
      busy={busy}
      onClose={onClose}
      onRequestClose={() => {
        if (!newFolderOpen) return false
        closeNewFolder()
        return true
      }}
      cardStyle={{ backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.line }}
      trailing={
        itemName ? (
          <View style={s.moveFilePill}>
            <Icon name={itemIcon} size={16} color={colors.muted} />
            <Text numberOfLines={1} style={s.moveFilePillText}>
              {itemName}
            </Text>
          </View>
        ) : undefined
      }
    >
      <ScrollView
        ref={scroll}
        style={s.moveScroll}
        contentContainerStyle={s.moveScrollContent}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => {
          if (newFolderOpen || error) revealInput()
        }}
      >
        <View style={s.moveCrumbs}>
          <Icon name={current ? 'folder' : 'home'} size={18} color={colors.muted} />
          <ScrollView
            ref={crumbScroll}
            horizontal
            showsHorizontalScrollIndicator={false}
            style={s.moveCrumbScroll}
            contentContainerStyle={s.moveCrumbRow}
            onContentSizeChange={() => crumbScroll.current?.scrollToEnd({ animated: false })}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Go to ${vaultName} root`}
              disabled={busy}
              onPress={() => navigate('')}
              hitSlop={{ top: 14, bottom: 14 }}
            >
              <Text style={[s.moveCrumb, current === '' && s.moveCrumbCurrent]}>{vaultName}</Text>
            </Pressable>
            {crumbs.map((crumb, index) => {
              const last = index === crumbs.length - 1
              return (
                <Fragment key={crumb.path}>
                  <Icon name="chevronRight" size={16} color={colors.muted} />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Go to ${crumb.path}`}
                    disabled={busy || last}
                    onPress={() => navigate(crumb.path)}
                    hitSlop={{ top: 14, bottom: 14 }}
                  >
                    <Text style={[s.moveCrumb, last && s.moveCrumbCurrent]}>{crumb.name}</Text>
                  </Pressable>
                </Fragment>
              )
            })}
          </ScrollView>
        </View>
        {children.map((child) => {
          const count = counts ? (counts.get(child.path) ?? 0) : undefined
          return (
            <Pressable
              key={child.path}
              accessibilityRole="button"
              accessibilityLabel={`Open ${child.name}`}
              disabled={busy}
              onPress={() => navigate(child.path)}
              style={({ pressed }) => [s.moveRow, pressed && s.pressed]}
            >
              <View style={s.moveRowIcon}>
                <Icon name="folder" size={20} color={colors.accent} />
              </View>
              <Text numberOfLines={1} style={s.moveRowName}>
                {child.name}
              </Text>
              {count !== undefined ? <Text style={s.moveRowCount}>{count}</Text> : null}
              <Icon name="chevronRight" size={18} color={colors.muted} />
            </Pressable>
          )
        })}
        {children.length === 0 ? <Text style={s.moveEmpty}>No folders in here.</Text> : null}
        {newFolderOpen ? (
          <>
            <View style={s.moveNewInputRow}>
              <Icon name="folder" size={20} color={colors.accent} />
              <TextInput
                accessibilityLabel="New folder name"
                value={newName}
                onChangeText={(value) => {
                  setNewName(value)
                  setError(null)
                }}
                editable={!busy}
                autoFocus
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={200}
                placeholder="Folder name"
                placeholderTextColor={colors.muted}
                returnKeyType="done"
                onSubmitEditing={() => void confirm()}
                cursorColor={colors.accent}
                style={s.moveNewInput}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel new folder"
                hitSlop={10}
                disabled={busy}
                onPress={closeNewFolder}
                style={s.moveNewClose}
              >
                <Icon name="close" size={18} color={colors.muted} />
              </Pressable>
            </View>
            {parts.length > 0 ? (
              <View style={s.movePreview}>
                <Text style={s.movePreviewLabel}>Will create</Text>
                {preview.map((part, index) => (
                  <Fragment key={preview.slice(0, index + 1).join('/')}>
                    {index > 0 ? <Icon name="chevronRight" size={14} color={colors.muted} /> : null}
                    <Text style={s.movePreviewPart}>{part}</Text>
                  </Fragment>
                ))}
              </View>
            ) : null}
            <Text style={s.moveHint}>
              {parts.length === 0
                ? 'Type a name. Use a / to nest folders.'
                : 'Type a / to nest folders.'}
            </Text>
          </>
        ) : null}
        {error ? (
          <View style={s.sheetError}>
            <ErrorBanner message={error} onDismiss={() => setError(null)} />
          </View>
        ) : null}
      </ScrollView>
      {!newFolderOpen ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Create a new folder in ${current || vaultName}`}
          disabled={busy}
          onPress={openNewFolder}
          style={({ pressed }) => [s.moveRow, pressed && s.pressed, busy && s.disabled]}
        >
          <View style={s.moveRowIcon}>
            <Icon name="plus" size={20} color={colors.accent} />
          </View>
          <Text numberOfLines={1} style={s.moveNewText}>
            New folder here
          </Text>
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={actionLabel}
        disabled={busy || sameFolder || (newFolderOpen && !canCreate)}
        onPress={() => void confirm()}
        style={({ pressed }) => [
          s.moveButton,
          pressed && s.pressed,
          (busy || sameFolder || (newFolderOpen && !canCreate)) && s.moveButtonDisabled,
        ]}
      >
        <Text
          style={[
            s.moveButtonText,
            (busy || sameFolder || (newFolderOpen && !canCreate)) && s.moveButtonTextDisabled,
          ]}
        >
          {actionLabel}
        </Text>
      </Pressable>
    </BottomSheet>
  )
}
export function SortSheet({
  sort,
  onChange,
  onClose,
}: {
  sort: NoteSort
  onChange: (sort: NoteSort) => void
  onClose: () => void
}) {
  const s = useStyles()
  const { colors } = useTheme()
  const dismiss = useRef<(after?: () => void) => void>(() => {})
  return (
    <BottomSheet title="Sort notes" onClose={onClose} dismissRef={dismiss} cardHeight={300}>
      <View accessibilityRole="radiogroup" style={s.sortCards}>
        {noteSorts.map((option) => {
          const active = sort === option.ascValue || sort === option.descValue
          const ascending = active
            ? sort === option.ascValue
            : option.defaultValue === option.ascValue
          const direction = ascending ? option.ascending : option.descending
          return (
            <Pressable
              key={option.key}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              accessibilityLabel={`${option.label}, ${direction}`}
              onPress={() => {
                if (!active) onChange(option.defaultValue)
                else onChange(ascending ? option.descValue : option.ascValue)
              }}
              style={({ pressed }) => [
                s.sortCard,
                active && s.sortCardActive,
                pressed && s.pressed,
              ]}
            >
              <View style={s.sortCardTitleRow}>
                <Text style={[s.sortCardTitle, active && s.sortCardTitleActive]}>
                  {option.label}
                </Text>
                {active ? (
                  <SwapIcon
                    from="arrowDown"
                    to="arrowUp"
                    active={sort !== option.defaultValue}
                    size={20}
                    color={colors.onAccent}
                  />
                ) : null}
              </View>
              <Text style={[s.sortCardDirection, active && s.sortCardDirectionActive]}>
                {direction}
              </Text>
            </Pressable>
          )
        })}
      </View>
      <View style={s.sortHint}>
        <Icon name="arrowUpDown" size={18} color={colors.muted} />
        <Text style={s.sortHintText}>Tap the selected one again to reverse the order.</Text>
      </View>
    </BottomSheet>
  )
}
