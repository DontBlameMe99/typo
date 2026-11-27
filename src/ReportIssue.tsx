import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { issuesUrl } from './about'
import { Icon } from './icons'
import { useTheme } from './theme'

const reportUrl =
  `${issuesUrl}/new?template=bug-report.yml` +
  `&title=${encodeURIComponent('[Bug]: ')}` +
  `&description=${encodeURIComponent(
    'Do not paste note content, private file paths, screenshots of your vault, or full error logs. ' +
      'Use fabricated examples and redacted details instead.\n\n' +
      'What happened:'
  )}` +
  `&reproduction=${encodeURIComponent('Steps with fabricated or redacted details:')}` +
  `&expected=${encodeURIComponent('Expected behavior:')}` +
  `&environment=${encodeURIComponent('App version, Android version, and device:')}`
export function ReportIssue() {
  const { colors } = useTheme()
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel="Report an issue. Opens in your browser"
      onPress={() =>
        void Linking.openURL(reportUrl).catch(() => Alert.alert('Cannot open link', reportUrl))
      }
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: colors.soft },
        pressed && styles.pressed,
      ]}
    >
      <Icon name="bug" size={22} color={colors.muted} />
      <View style={styles.text}>
        <Text style={[styles.title, { color: colors.ink }]}>Report an issue</Text>
        <Text numberOfLines={1} style={[styles.url, { color: colors.muted }]}>
          {issuesUrl.replace('https://', '')}
        </Text>
      </View>
      <Icon name="external" size={16} color={colors.muted} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: 64,
    paddingHorizontal: 16,
    borderRadius: 24,
  },
  pressed: { opacity: 0.66 },
  text: { flex: 1, minWidth: 0 },
  title: { fontFamily: 'DMSans_600SemiBold', fontSize: 16 },
  url: { fontFamily: 'DMSans_400Regular', fontSize: 12, marginTop: 1 },
})
