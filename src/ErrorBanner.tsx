import { useEffect, useMemo } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import Reanimated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { Icon } from './icons'
import { useTheme } from './theme'

type BannerAction = { label: string; onPress: () => void }

export function ErrorBanner({
  message,
  title,
  code,
  onDismiss,
  actions,
}: {
  message: string
  title?: string
  code?: string
  onDismiss?: () => void
  actions?: BannerAction[]
}) {
  const { colors } = useTheme()
  const s = useMemo(() => styles(colors), [colors])
  const reveal = useSharedValue(0)
  useEffect(() => {
    reveal.value = withTiming(1, { duration: 200, reduceMotion: ReduceMotion.System })
  }, [reveal])
  const motion = useAnimatedStyle(() => ({
    opacity: reveal.value,
    transform: [{ translateY: (1 - reveal.value) * 6 }],
  }))
  return (
    <Reanimated.View accessibilityLiveRegion="polite" style={[s.banner, motion]}>
      <Icon name="alert" color={colors.coral} />
      <View style={s.body}>
        {title && <Text style={s.title}>{title}</Text>}
        {code && (
          <Text selectable={false} style={s.code}>
            {code}
          </Text>
        )}
        <ScrollView style={s.details} nestedScrollEnabled>
          <Text selectable={false} style={s.message}>
            {message.slice(0, 200)}
          </Text>
        </ScrollView>
        {actions?.length ? (
          <View style={s.actions}>
            {actions.map((action) => (
              <Pressable
                key={action.label}
                accessibilityRole="button"
                accessibilityLabel={action.label}
                onPress={action.onPress}
                style={({ pressed }) => [s.action, pressed && s.pressed]}
              >
                <Text style={s.actionText}>{action.label}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
      {onDismiss && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss error"
          onPress={onDismiss}
          style={({ pressed }) => [s.dismiss, pressed && s.pressed]}
        >
          <Icon name="close" />
        </Pressable>
      )}
    </Reanimated.View>
  )
}

function styles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    banner: {
      backgroundColor: colors.coralSoft,
      borderRadius: 14,
      padding: 13,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
    },
    body: { flex: 1 },
    title: {
      color: colors.ink,
      fontSize: 15,
      lineHeight: 22,
      fontFamily: 'DMSans_600SemiBold',
      marginBottom: 6,
    },
    details: { maxHeight: 180 },
    message: {
      flex: 1,
      color: colors.ink,
      fontSize: 14,
      lineHeight: 20,
      fontFamily: 'DMSans_400Regular',
    },
    code: {
      color: colors.muted,
      fontFamily: 'DMSans_400Regular',
      fontSize: 11,
      marginBottom: 4,
    },
    actions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 9,
    },
    action: {
      backgroundColor: colors.accent,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    actionText: {
      color: colors.onAccent,
      fontFamily: 'DMSans_600SemiBold',
      fontSize: 13,
    },
    dismiss: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 14,
    },
    pressed: { opacity: 0.66 },
  })
}
