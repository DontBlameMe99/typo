import { DMSans_400Regular, DMSans_600SemiBold, useFonts } from '@expo-google-fonts/dm-sans'
import * as SplashScreen from 'expo-splash-screen'
import type * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppState, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native'
import {
  initialWindowMetrics,
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context'
import {
  clearQuickDraft,
  type QuickDraft,
  type QuickDraftKind,
  readQuickDraft,
  saveQuickDraft,
} from './quick-draft'
import { markQuickTileOpened } from './quick-tile-session'
import { ThemeProvider, useTheme } from './theme'

const fonts = { DMSans_400Regular, DMSans_600SemiBold }

export function QuickSheetRoot({ children }: { children: React.ReactNode }) {
  const [loaded, fontError] = useFonts(fonts)
  useEffect(() => {
    markQuickTileOpened()
    void SplashScreen.hideAsync().catch(() => {})
  }, [])
  if (!loaded && !fontError) return null
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <ThemeProvider>{children}</ThemeProvider>
    </SafeAreaProvider>
  )
}

export function useQuickSheet(close: () => void | Promise<void>): void {
  // Back, background, and Close all go through close(), so a draft or note write
  // settles before the tile activity ends.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      void close()
      return true
    })
    return () => subscription.remove()
  }, [close])

  // Backgrounding finishes the tile activity, so drafts are written to private
  // storage and restored when the sheet opens again. A running save keeps going
  // in the shared runtime and close waits for it.
  useEffect(() => {
    // A tile opens the activity while the Quick Settings panel closes, which
    // can emit a background event before this sheet is usable. Wait for an
    // active frame before treating background as a request to close.
    let active = AppState.currentState === 'active'
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        active = true
        return
      }
      if (active && state === 'background') void close()
    })
    return () => subscription.remove()
  }, [close])
}

export function useQuickDraft(kind: QuickDraftKind) {
  const [draft, setDraft] = useState<QuickDraft>(() => readQuickDraft(kind))
  const current = useRef(draft)
  const pending = useRef<Promise<void>>(Promise.resolve())

  const update = useCallback(
    (patch: QuickDraft) => {
      const next = { ...current.current, ...patch }
      current.current = next
      setDraft(next)
      pending.current = saveQuickDraft(kind, next).catch(() => {})
    },
    [kind]
  )

  const clear = useCallback(async () => {
    current.current = {}
    setDraft({})
    await pending.current
    await clearQuickDraft(kind).catch(() => {})
  }, [kind])

  return { draft, update, clear, pending }
}

export function QuickToolbar({
  title,
  actionLabel,
  busyLabel,
  canSubmit,
  saving,
  closeLabel,
  actionAccessibilityLabel,
  onClose,
  onSubmit,
}: {
  title: string
  actionLabel: string
  busyLabel: string
  canSubmit: boolean
  saving: boolean
  closeLabel: string
  actionAccessibilityLabel: string
  onClose: () => void
  onSubmit: () => void
}) {
  const s = useQuickStyles()
  return (
    <View style={s.toolbar}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={closeLabel}
        disabled={saving}
        onPress={onClose}
        style={({ pressed }) => [s.close, pressed && s.pressed]}
      >
        <Text style={s.closeText}>Close</Text>
      </Pressable>
      <Text style={s.heading}>{title}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={actionAccessibilityLabel}
        disabled={!canSubmit}
        onPress={onSubmit}
        style={({ pressed }) => [s.action, pressed && s.pressed, !canSubmit && s.actionOff]}
      >
        <Text style={[s.actionText, !canSubmit && s.actionTextOff]}>
          {saving ? busyLabel : actionLabel}
        </Text>
      </Pressable>
    </View>
  )
}

export function useQuickStyles() {
  const { colors } = useTheme()
  const { bottom } = useSafeAreaInsets()
  return useMemo(() => quickStyles(colors, bottom), [colors, bottom])
}

function quickStyles(colors: ReturnType<typeof useTheme>['colors'], bottom: number) {
  return StyleSheet.create({
    root: { flex: 1 },
    backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0, 0, 0, 0.45)' },
    card: {
      flex: 1,
      marginTop: 96,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      backgroundColor: colors.paper,
      paddingBottom: bottom + 12,
    },
    flex: { flex: 1 },
    toolbar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingTop: 16,
      paddingHorizontal: 16,
      paddingBottom: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.line,
    },
    heading: {
      flex: 1,
      fontFamily: 'DMSans_600SemiBold',
      fontSize: 22,
      letterSpacing: -0.4,
      color: colors.ink,
      textAlign: 'center',
    },
    close: { minWidth: 64, height: 44, justifyContent: 'center' },
    closeText: { fontFamily: 'DMSans_600SemiBold', fontSize: 15, color: colors.muted },
    action: {
      minWidth: 96,
      height: 44,
      paddingHorizontal: 20,
      borderRadius: 22,
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    actionOff: { backgroundColor: colors.surface },
    actionText: { fontFamily: 'DMSans_600SemiBold', fontSize: 16, color: colors.onAccent },
    actionTextOff: { color: colors.muted },
    pressed: { opacity: 0.6 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 20 },
    notice: {
      fontFamily: 'DMSans_400Regular',
      fontSize: 16,
      lineHeight: 24,
      color: colors.muted,
      textAlign: 'center',
    },
    noticeButton: {
      height: 44,
      paddingHorizontal: 24,
      borderRadius: 22,
      backgroundColor: colors.soft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    noticeButtonText: {
      fontFamily: 'DMSans_600SemiBold',
      fontSize: 16,
      color: colors.ink,
    },
    errorInset: { paddingHorizontal: 4, marginBottom: 12 },
  })
}

export function useQuickFormStyles(bodyMinHeight: number) {
  const { colors } = useTheme()
  return useMemo(() => formStyles(colors, bodyMinHeight), [colors, bodyMinHeight])
}

export function quickErrorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function formStyles(colors: ReturnType<typeof useTheme>['colors'], bodyMinHeight: number) {
  return StyleSheet.create({
    form: { paddingTop: 24, paddingHorizontal: 20, paddingBottom: 40, flexGrow: 1 },
    title: {
      fontFamily: 'DMSans_600SemiBold',
      fontSize: 32,
      lineHeight: 38,
      letterSpacing: -0.8,
      color: colors.ink,
      padding: 0,
    },
    divider: { height: 1, backgroundColor: colors.line, marginVertical: 16 },
    target: {
      paddingBottom: 16,
      marginBottom: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.line,
    },
    targetText: {
      fontFamily: 'DMSans_400Regular',
      fontSize: 14,
      color: colors.muted,
    },
    body: {
      flex: 1,
      minHeight: bodyMinHeight,
      padding: 0,
      fontFamily: 'DMSans_400Regular',
      fontSize: 18,
      lineHeight: 27,
      color: colors.ink,
    },
  })
}
