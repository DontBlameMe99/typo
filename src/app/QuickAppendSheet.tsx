import { useMemo, useState } from 'react'
import { Keyboard, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { headingKey, headingMatches, listHeadings } from '../append'
import { isRootTemplate } from '../core'
import { Icon } from '../icons'
import type { QuickAppendTarget } from '../quick-append-config'
import { useTheme } from '../theme'
import type { Note, Vault } from '../types'
import { useStyles } from './styles'
import { BottomSheet } from './ui'

export function QuickAppendSheet({
  vault,
  notes,
  current,
  onSave,
  onClear,
  onClose,
}: {
  vault: Vault
  notes: Note[]
  current: QuickAppendTarget | null
  onSave: (target: QuickAppendTarget) => void
  onClear: () => void
  onClose: () => void
}) {
  const s = useStyles()
  const { colors } = useTheme()
  const [note, setNote] = useState<Note | null>(null)
  const [query, setQuery] = useState('')
  const needle = query.trim().toLocaleLowerCase()
  const choices = useMemo(
    () =>
      [...notes]
        .filter((candidate) => !isRootTemplate(candidate.path))
        .filter(
          (candidate) =>
            !needle ||
            candidate.path.toLocaleLowerCase().includes(needle) ||
            candidate.title.toLocaleLowerCase().includes(needle)
        )
        .sort((a, b) => a.path.localeCompare(b.path))
        .slice(0, 60),
    [needle, notes]
  )
  const sections = useMemo(() => {
    if (!note) return { headings: [] as ReturnType<typeof listHeadings>, duplicates: false }
    const all = listHeadings(note.source)
    const counts = new Map<string, number>()
    for (const heading of all) {
      const key = headingKey(heading)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return {
      headings: all
        .filter((heading) => counts.get(headingKey(heading)) === 1)
        .filter((heading) => !needle || heading.text.toLocaleLowerCase().includes(needle))
        .slice(0, 60),
      duplicates: [...counts.values()].some((count) => count > 1),
    }
  }, [needle, note])
  const headings = sections.headings
  const backToNotes = () => {
    Keyboard.dismiss()
    setNote(null)
    setQuery('')
  }

  return (
    <BottomSheet
      title={note ? 'Choose a section' : 'Choose a note'}
      cardHeight={560}
      onClose={onClose}
      onRequestClose={() => {
        if (!note) return false
        backToNotes()
        return true
      }}
    >
      <ScrollView
        style={s.flex}
        contentContainerStyle={s.settingsBody}
        keyboardShouldPersistTaps="handled"
      >
        <View style={s.searchField}>
          <Icon name="search" size={18} color={colors.muted} />
          <TextInput
            accessibilityLabel={note ? 'Search sections' : 'Search notes'}
            placeholder={note ? 'Search sections' : 'Search notes'}
            placeholderTextColor={colors.muted}
            value={query}
            onChangeText={setQuery}
            style={s.searchFieldInput}
          />
        </View>
        {note ? (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back to notes"
              onPress={backToNotes}
              style={({ pressed }) => [s.sheetRow, s.settingsRow, pressed && s.rowPressed]}
            >
              <Icon name="arrowLeft" size={20} color={colors.muted} />
              <View style={s.sheetRowText}>
                <Text style={s.sheetRowTitle}>{note.path}</Text>
              </View>
            </Pressable>
            {headings.length === 0 ? (
              <Text style={[s.sheetRowPath, { padding: 16, textAlign: 'center' }]}>
                {sections.duplicates
                  ? 'Rename duplicate headings before choosing a section.'
                  : needle
                    ? 'No sections match that search.'
                    : 'This note has no headings. Add one before choosing it as a target.'}
              </Text>
            ) : (
              headings.map((heading) => {
                const selected =
                  note.path === current?.notePath &&
                  headingMatches(heading, {
                    level: current?.sectionLevel ?? 0,
                    text: current?.section ?? '',
                  })
                return (
                  <Pressable
                    key={`${note.path}:${heading.line}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Append to ${heading.text}`}
                    onPress={() => {
                      onSave({
                        vaultUri: vault.uri,
                        noteUri: note.uri,
                        notePath: note.path,
                        section: heading.text,
                        sectionLevel: heading.level,
                      })
                      onClose()
                    }}
                    style={({ pressed }) => [s.sheetRow, s.settingsRow, pressed && s.rowPressed]}
                  >
                    <Icon
                      name={selected ? 'check' : 'file'}
                      size={20}
                      color={selected ? colors.accent : colors.muted}
                    />
                    <View style={s.sheetRowText}>
                      <Text style={[s.sheetRowTitle, selected && { color: colors.accent }]}>
                        {'='.repeat(heading.level)} {heading.text}
                      </Text>
                    </View>
                    <Icon name="chevronRight" size={16} color={colors.muted} />
                  </Pressable>
                )
              })
            )}
          </>
        ) : choices.length === 0 ? (
          <Text style={[s.sheetRowPath, { padding: 16, textAlign: 'center' }]}>
            No notes match that search.
          </Text>
        ) : (
          choices.map((choice) => (
            <Pressable
              key={choice.uri}
              accessibilityRole="button"
              accessibilityLabel={`Choose ${choice.path}`}
              onPress={() => {
                setNote(choice)
                setQuery('')
              }}
              style={({ pressed }) => [s.sheetRow, s.settingsRow, pressed && s.rowPressed]}
            >
              <Icon name="file" size={20} color={colors.muted} />
              <View style={s.sheetRowText}>
                <Text style={s.sheetRowTitle}>{choice.title}</Text>
                <Text numberOfLines={1} style={s.sheetRowPath}>
                  {choice.path}
                </Text>
              </View>
              <Icon name="chevronRight" size={16} color={colors.muted} />
            </Pressable>
          ))
        )}
        {current && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear quick append target"
            onPress={() => {
              onClear()
              onClose()
            }}
            style={({ pressed }) => [s.sheetRow, s.settingsRow, pressed && s.rowPressed]}
          >
            <Icon name="trash" size={20} color={colors.muted} />
            <View style={s.sheetRowText}>
              <Text style={s.sheetRowTitle}>Clear target</Text>
            </View>
          </Pressable>
        )}
      </ScrollView>
    </BottomSheet>
  )
}
