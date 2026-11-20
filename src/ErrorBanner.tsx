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

export function ErrorBanner({
  message,
  title,
  onDismiss,
}: {
  message: string
  title?: string
  onDismiss?: () => void
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
        <ScrollView style={s.details} nestedScrollEnabled>
          <Text selectable style={s.message}>
            {message}
          </Text>
        </ScrollView>
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
