import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ScrollViewInstance } from 'react-native'
import {
  Alert,
  Keyboard,
  Linking,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Reanimated, {
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { appCommit, appVersion, commitUrl, issuesUrl, repositoryUrl } from '../about'
import { contrastRatio, hexToHsl, hslToHex, parseHex } from '../color'
import { Icon } from '../icons'
import { type QuickAppendTarget, quickAppendLabel } from '../quick-append-config'
import type { AppearanceMode, Flavor } from '../theme'
import {
  accentNames,
  darkFlavorNames,
  lightFlavorNames,
  onColor,
  palettes,
  useTheme,
} from '../theme'
import type { Note, Vault } from '../types'
import { PillTabs, spring } from './motion'
import { QuickAppendSheet } from './QuickAppendSheet'
import { SWIPE_SPRING } from './shared'
import { useStyles } from './styles'
import { BottomSheet, Screen } from './ui'

// The AMOLED track is 52 wide and the 24 thumb sits 4 from each edge.
const TOGGLE_TRAVEL = 20

const APPEARANCE_MODE_OPTIONS: readonly { value: AppearanceMode; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

const SETTINGS_TABS = [
  { value: 'interface', label: 'Interface' },
  { value: 'library', label: 'Library' },
  { value: 'about', label: 'About' },
] as const

type SettingsTab = (typeof SETTINGS_TABS)[number]['value']

export function Settings({
  vault,
  vaultName,
  notes,
  quickTarget,
  picking,
  onChangeFolder,
  onSaveQuickTarget,
  onClearQuickTarget,
  onClose,
}: {
  vault: Vault
  vaultName: string
  notes: Note[]
  quickTarget: QuickAppendTarget | null
  picking: boolean
  onChangeFolder: () => void
  onSaveQuickTarget: (target: QuickAppendTarget) => void
  onClearQuickTarget: () => void
  onClose: () => void
}) {
  const s = useStyles()
  const { settings, updateSettings, palette, colors, persistenceError } = useTheme()
  const [customOpen, setCustomOpen] = useState(false)
  const [quickOpen, setQuickOpen] = useState(false)
  const [tab, setTab] = useState<SettingsTab>('interface')
  const scroll = useRef<ScrollViewInstance>(null)
  const dismiss = useRef<(after?: () => void) => void>(() => {})
  const custom = settings.customAccent
  const open = (url: string) => {
    void Linking.openURL(url).catch(() => Alert.alert('Cannot open link', url))
  }
  const shortCommit = appCommit ? appCommit.slice(0, 7) : null
  const amoled = useSharedValue(settings.amoled ? 1 : 0)
  useEffect(() => {
    amoled.value = spring(settings.amoled ? 1 : 0, SWIPE_SPRING)
  }, [amoled, settings.amoled])
  const toggleTrack = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(amoled.value, [0, 1], [colors.surface, colors.accent]),
  }))
  const toggleThumb = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(amoled.value, [0, 1], [colors.muted, colors.onAccent]),
    transform: [{ translateX: amoled.value * TOGGLE_TRAVEL }],
  }))
  return (
    <>
      <Screen onClose={onClose} swipeBack dismissRef={dismiss}>
        <View style={s.screen}>
          {persistenceError ? (
            <View style={s.errorInset}>
              <Text accessibilityLiveRegion="polite" style={[s.errorText, { flex: 0 }]}>
                {persistenceError}
              </Text>
            </View>
          ) : null}
          <ScrollView ref={scroll} contentContainerStyle={s.settingsBody}>
            {tab === 'library' ? (
              <View style={s.settingsGroup}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Notes folder: ${vaultName}. Choose folder`}
                  disabled={picking}
                  onPress={onChangeFolder}
                  style={({ pressed }) => [
                    s.sheetRow,
                    s.settingsRow,
                    pressed && s.rowPressed,
                    picking && s.disabled,
                  ]}
                >
                  <Icon name="folderOpen" size={20} color={colors.muted} />
                  <View style={s.sheetRowText}>
                    <Text style={s.sheetRowTitle}>Notes folder</Text>
                    <Text numberOfLines={1} style={s.sheetRowPath}>
                      {vaultName}
                    </Text>
                  </View>
                  <Icon name="swap" size={18} color={colors.muted} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    quickTarget
                      ? `Quick append target: ${quickAppendLabel(quickTarget)}. Choose target`
                      : 'Quick append target not set. Choose target'
                  }
                  onPress={() => setQuickOpen(true)}
                  style={({ pressed }) => [s.sheetRow, s.settingsRow, pressed && s.rowPressed]}
                >
                  <Icon name="edit" size={20} color={colors.muted} />
                  <View style={s.sheetRowText}>
                    <Text style={s.sheetRowTitle}>Quick append</Text>
                    <Text numberOfLines={1} style={s.sheetRowPath}>
                      {quickTarget ? quickAppendLabel(quickTarget) : 'Not set'}
                    </Text>
                  </View>
                  <Icon name="chevronRight" size={18} color={colors.muted} />
                </Pressable>
              </View>
            ) : null}
            <View style={[s.settingsGroup, tab !== 'interface' && s.hiddenTab]}>
              <PillTabs
                options={APPEARANCE_MODE_OPTIONS}
                value={settings.mode}
                onSelect={(mode) => updateSettings({ mode })}
                style={s.modeRow}
                itemStyle={s.modeButton}
                textStyle={s.modeText}
                maxFontSizeMultiplier={1.25}
                pillStyle={{ backgroundColor: colors.accent, borderRadius: 22 }}
                inset={4}
                activeColor={colors.onAccent}
                idleColor={colors.ink}
              />
              <View style={s.flavorRow}>
                <View accessibilityRole="radiogroup" style={s.flavorLight}>
                  <FlavorOption
                    flavor={lightFlavorNames[0]}
                    selected={settings.lightFlavor === lightFlavorNames[0]}
                    onPress={() => updateSettings({ lightFlavor: lightFlavorNames[0] })}
                  />
                </View>
                <View style={s.flavorDivider} />
                <View style={s.flavorDarkGroup}>
                  <View accessibilityRole="radiogroup" style={s.flavorDarkRow}>
                    {darkFlavorNames.map((flavor) => (
                      <FlavorOption
                        key={flavor}
                        flavor={flavor}
                        selected={settings.darkFlavor === flavor}
                        onPress={() => updateSettings({ darkFlavor: flavor })}
                      />
                    ))}
                  </View>
                </View>
              </View>
              <View accessibilityRole="radiogroup" style={s.accentGrid}>
                {accentNames.map((accent) => (
                  <AccentSwatch
                    key={accent}
                    label={accent}
                    color={palette[accent]}
                    selected={!custom && settings.accent === accent}
                    onPress={() => updateSettings({ accent, customAccent: null })}
                  />
                ))}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={custom ? 'Edit custom color' : 'Choose a custom color'}
                onPress={() => setCustomOpen(true)}
                style={({ pressed }) => [s.customRow, pressed && s.pressed]}
              >
                <View
                  style={[
                    s.customCircle,
                    custom && { backgroundColor: custom, borderColor: custom },
                  ]}
                >
                  {custom ? (
                    <Icon name="check" size={18} color={onColor(custom)} />
                  ) : (
                    <Icon name="plus" size={16} color={colors.muted} />
                  )}
                  {custom ? <View style={s.selectedRing} /> : null}
                </View>
                <View style={s.flex}>
                  <Text style={s.customTitle}>Custom color</Text>
                  {custom ? <Text style={s.customHex}>{custom}</Text> : null}
                </View>
                {custom ? (
                  <View style={s.customEdit}>
                    <Icon name="edit" size={16} color={colors.accent} />
                    <Text style={s.customEditText}>Edit</Text>
                  </View>
                ) : null}
              </Pressable>
              <Pressable
                accessibilityRole="switch"
                accessibilityLabel="AMOLED black. Use pure black in dark mode."
                accessibilityState={{ checked: settings.amoled }}
                onPress={() => updateSettings({ amoled: !settings.amoled })}
                style={({ pressed }) => [s.amoledRow, pressed && s.pressed]}
              >
                <View style={s.flex}>
                  <Text style={s.amoledTitle}>AMOLED black</Text>
                  <Text style={s.amoledBody}>Pure black in dark mode.</Text>
                </View>
                <Reanimated.View style={[s.toggleTrack, toggleTrack]}>
                  <Reanimated.View style={[s.toggleThumb, toggleThumb]} />
                </Reanimated.View>
              </Pressable>
            </View>
            {tab === 'about' ? (
              <View style={s.settingsGroup}>
                <View style={[s.sheetRow, s.settingsRow]}>
                  <Icon name="info" size={20} color={colors.muted} />
                  <View style={s.sheetRowText}>
                    <Text style={s.sheetRowTitle}>Version</Text>
                  </View>
                  <Text style={s.aboutValue}>{appVersion}</Text>
                </View>
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel={
                    shortCommit
                      ? `Commit ${shortCommit}. Opens in your browser`
                      : 'Development build'
                  }
                  disabled={!shortCommit}
                  onPress={() => {
                    if (appCommit) open(commitUrl(appCommit))
                  }}
                  style={({ pressed }) => [s.sheetRow, s.settingsRow, pressed && s.rowPressed]}
                >
                  <Icon name="commit" size={20} color={colors.muted} />
                  <View style={s.sheetRowText}>
                    <Text style={s.sheetRowTitle}>Commit</Text>
                    <Text numberOfLines={1} style={s.sheetRowPath}>
                      {shortCommit ?? 'Development build'}
                    </Text>
                  </View>
                  {shortCommit ? <Icon name="external" size={16} color={colors.muted} /> : null}
                </Pressable>
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel="Report an issue. Opens in your browser"
                  onPress={() => open(issuesUrl)}
                  style={({ pressed }) => [s.sheetRow, s.settingsRow, pressed && s.rowPressed]}
                >
                  <Icon name="bug" size={20} color={colors.muted} />
                  <View style={s.sheetRowText}>
                    <Text style={s.sheetRowTitle}>Report an issue</Text>
                    <Text numberOfLines={1} style={s.sheetRowPath}>
                      {issuesUrl.replace('https://', '')}
                    </Text>
                  </View>
                  <Icon name="external" size={16} color={colors.muted} />
                </Pressable>
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel="Source code. Opens in your browser"
                  onPress={() => open(repositoryUrl)}
                  style={({ pressed }) => [s.sheetRow, s.settingsRow, pressed && s.rowPressed]}
                >
                  <Icon name="code" size={20} color={colors.muted} />
                  <View style={s.sheetRowText}>
                    <Text style={s.sheetRowTitle}>Source</Text>
                    <Text numberOfLines={1} style={s.sheetRowPath}>
                      {repositoryUrl.replace('https://', '')}
                    </Text>
                  </View>
                  <Icon name="external" size={16} color={colors.muted} />
                </Pressable>
              </View>
            ) : null}
          </ScrollView>
          <View style={s.noteDockShell}>
            <View style={s.noteDock}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close settings"
                onPress={() => dismiss.current()}
                style={({ pressed }) => [s.barButton, s.barButtonFloating, pressed && s.pressed]}
              >
                <Icon name="close" size={24} color={colors.ink} />
              </Pressable>
              <PillTabs
                options={SETTINGS_TABS}
                value={tab}
                onSelect={(next) => {
                  scroll.current?.scrollTo({ y: 0, animated: false })
                  setTab(next)
                }}
                style={s.noteSegments}
                itemStyle={s.noteSegment}
                textStyle={s.settingsSegmentText}
                maxFontSizeMultiplier={1}
                pillStyle={{ backgroundColor: colors.accent, borderRadius: 19 }}
                inset={5}
                activeColor={colors.onAccent}
                idleColor={colors.ink}
              />
            </View>
          </View>
        </View>
      </Screen>
      {quickOpen && (
        <QuickAppendSheet
          vault={vault}
          notes={notes}
          current={quickTarget}
          onSave={(target) => void onSaveQuickTarget(target)}
          onClear={() => void onClearQuickTarget()}
          onClose={() => setQuickOpen(false)}
        />
      )}
      {customOpen && (
        <CustomColorSheet
          initial={custom ?? colors.accent}
          onClose={() => setCustomOpen(false)}
          onPick={(hex) => {
            updateSettings({ customAccent: hex })
            setCustomOpen(false)
          }}
        />
      )}
    </>
  )
}

function AccentSwatch({
  label,
  color,
  selected,
  onPress,
}: {
  label: string
  color: string
  selected: boolean
  onPress: () => void
}) {
  const s = useStyles()
  const mark = useSharedValue(selected ? 1 : 0)
  const settle = useSharedValue(1)
  useEffect(() => {
    // The switch itself is immediate: the ring lands on the new color in the
    // frame of the tap, and only the little settle after it animates. A swatch
    // that mounts already selected has nothing to settle.
    const next = selected ? 1 : 0
    if (mark.value === next) return
    mark.value = next
    if (!next) return
    settle.value = 1.14
    settle.value = spring(1, SWIPE_SPRING)
  }, [mark, selected, settle])
  const motion = useAnimatedStyle(() => ({
    opacity: mark.value,
    transform: [{ scale: mark.value * settle.value }],
  }))
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={s.accentPressable}
    >
      <View style={[s.accentSwatch, { backgroundColor: color }]}>
        <Reanimated.View style={[s.selectedRing, motion]} />
        <Reanimated.View style={motion}>
          <Icon name="check" size={18} color={onColor(color)} />
        </Reanimated.View>
      </View>
    </Pressable>
  )
}

function FlavorOption({
  flavor,
  selected,
  onPress,
}: {
  flavor: Flavor
  selected: boolean
  onPress: () => void
}) {
  const s = useStyles()
  const { settings, colors } = useTheme()
  const preview = palettes[flavor]
  const dot = selected ? colors.accent : preview[settings.accent]
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={`${flavor} palette`}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [s.flavorCard, pressed && s.pressed]}
    >
      <View
        style={[
          s.flavorPreview,
          { backgroundColor: preview.base },
          selected && { borderColor: colors.accent },
        ]}
      >
        <View style={[s.flavorDot, { backgroundColor: dot }]} />
        <View style={[s.flavorBar, { backgroundColor: preview.text }]} />
      </View>
      <Text
        maxFontSizeMultiplier={1}
        numberOfLines={1}
        style={[s.flavorText, selected && s.flavorTextSelected]}
      >
        {flavor === 'frappe' ? 'Frappé' : flavor.charAt(0).toUpperCase() + flavor.slice(1)}
      </Text>
    </Pressable>
  )
}

function ColorSlider({
  value,
  onChange,
  renderTrack,
  label,
  valueLabel,
  knobColor,
  step,
  accessibilityLabel,
}: {
  value: number
  onChange: (value: number) => void
  renderTrack: () => React.ReactNode
  label: string
  valueLabel: string
  knobColor: string
  step: number
  accessibilityLabel: string
}) {
  const s = useStyles()
  const width = useRef(0)
  const widthValue = useSharedValue(0)
  const position = useSharedValue(value)
  const dragging = useSharedValue(false)
  const last = useRef(0)
  const change = useRef(onChange)
  change.current = onChange
  const commitFraction = useCallback((fraction: number) => {
    change.current(Math.min(1, Math.max(0, fraction)))
  }, [])
  const commit = useCallback(
    (x: number) => {
      if (width.current <= 0) return
      commitFraction(x / width.current)
    },
    [commitFraction]
  )
  // The knob follows the finger on the UI thread. Rebuilding the gradient and
  // the hex field on every move re-renders the sheet, so those wait for the
  // throttle and the release.
  const commitThrottled = useCallback(
    (x: number) => {
      const now = Date.now()
      if (now - last.current < 40) return
      last.current = now
      commit(x)
    },
    [commit]
  )
  useEffect(() => {
    if (!dragging.value) position.value = value
  }, [dragging, position, value])
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .hitSlop({ top: 14, bottom: 14, left: 8, right: 8 })
        .onBegin((event) => {
          'worklet'
          dragging.value = true
          position.value = Math.min(1, Math.max(0, event.x / Math.max(widthValue.value, 1)))
          runOnJS(commit)(event.x)
        })
        .onUpdate((event) => {
          'worklet'
          position.value = Math.min(1, Math.max(0, event.x / Math.max(widthValue.value, 1)))
          runOnJS(commitThrottled)(event.x)
        })
        .onEnd((event) => {
          'worklet'
          runOnJS(commit)(event.x)
        })
        .onFinalize((_event, success) => {
          'worklet'
          dragging.value = false
          // A cancelled drag leaves the knob where the finger stopped. Commit
          // that position so the hex field matches what is on screen.
          if (!success) runOnJS(commitFraction)(position.value)
        }),
    [commit, commitFraction, commitThrottled, dragging, position, widthValue]
  )
  const knob = useAnimatedStyle(() => ({ left: `${position.value * 100}%` }))
  return (
    <View style={s.sliderSection}>
      <View style={s.sliderLabelRow}>
        <Text style={s.sliderLabel}>{label}</Text>
        <Text style={s.sliderValue}>{valueLabel}</Text>
      </View>
      <GestureDetector gesture={pan}>
        <View
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={accessibilityLabel}
          accessibilityValue={{ min: 0, max: 1, now: value, text: valueLabel }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(event) => {
            const delta = event.nativeEvent.actionName === 'increment' ? step : -step
            commitFraction(value + delta)
          }}
          hitSlop={15}
          style={s.sliderTrack}
          onLayout={(event) => {
            width.current = event.nativeEvent.layout.width
            widthValue.value = event.nativeEvent.layout.width
          }}
        >
          {renderTrack()}
          <Reanimated.View
            pointerEvents="none"
            style={[s.sliderKnob, knob, { backgroundColor: knobColor }]}
          />
        </View>
      </GestureDetector>
    </View>
  )
}

function CustomColorSheet({
  initial,
  onClose,
  onPick,
}: {
  initial: string
  onClose: () => void
  onPick: (hex: string) => void
}) {
  const s = useStyles()
  const { colors, palette } = useTheme()
  const start = parseHex(initial) ?? '#CBA6F7'
  const startHsl = hexToHsl(start)
  const [hue, setHue] = useState(startHsl.h)
  const [lightness, setLightness] = useState(startHsl.l)
  const [saturation, setSaturation] = useState(startHsl.s)
  const [hex, setHex] = useState(start)
  const [text, setText] = useState(start.slice(1))
  const applyHex = (value: string) => {
    const parsed = parseHex(`#${value}`)
    if (!parsed) return
    const hsl = hexToHsl(parsed)
    setHue(hsl.h)
    setLightness(hsl.l)
    setSaturation(hsl.s)
    setHex(parsed)
  }
  const applyHsl = (nextHue: number, nextLightness: number) => {
    const parsed = hslToHex({ h: nextHue, s: saturation, l: nextLightness })
    setHex(parsed)
    setText(parsed.slice(1))
  }
  const contrast = contrastRatio(hex, colors.paper)
  const readable = contrast >= 4.5
  return (
    <BottomSheet title="Custom color" onClose={onClose} cardHeight={620}>
      <ScrollView
        style={s.flex}
        contentContainerStyle={s.colorSheetBody}
        keyboardShouldPersistTaps="handled"
      >
        <View style={s.colorSection}>
          <Text style={s.colorLabel}>HEX</Text>
          <View style={[s.hexField, { borderColor: hex }]}>
            <View style={[s.hexSwatch, { backgroundColor: hex }]} />
            <Text style={s.hexHash}>#</Text>
            <TextInput
              accessibilityLabel="Custom hex color"
              value={text}
              onChangeText={(value) => {
                const next = value
                  .replace(/[^0-9a-fA-F]/gu, '')
                  .slice(0, 6)
                  .toUpperCase()
                setText(next)
                if (next.length === 6) applyHex(next)
              }}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={6}
              returnKeyType="done"
              onSubmitEditing={() => Keyboard.dismiss()}
              cursorColor={hex}
              style={s.hexInput}
            />
          </View>
        </View>
        <ColorSlider
          label="HUE"
          value={hue / 360}
          valueLabel={`${Math.round(hue)}°`}
          knobColor={hex}
          step={1 / 360}
          accessibilityLabel="Hue"
          onChange={(value) => {
            const nextHue = value * 360
            setHue(nextHue)
            applyHsl(nextHue, lightness)
          }}
          renderTrack={() => (
            <Svg width="100%" height="100%">
              <Defs>
                <LinearGradient id="hue-track" x1="0" y1="0" x2="1" y2="0">
                  <Stop offset="0" stopColor="#ff0000" />
                  <Stop offset="0.17" stopColor="#ffff00" />
                  <Stop offset="0.33" stopColor="#00ff00" />
                  <Stop offset="0.5" stopColor="#00ffff" />
                  <Stop offset="0.67" stopColor="#0000ff" />
                  <Stop offset="0.83" stopColor="#ff00ff" />
                  <Stop offset="1" stopColor="#ff0000" />
                </LinearGradient>
              </Defs>
              <Rect width="100%" height="100%" rx={7} fill="url(#hue-track)" />
            </Svg>
          )}
        />
        <ColorSlider
          label="LIGHTNESS"
          value={lightness}
          valueLabel={`${Math.round(lightness * 100)}%`}
          knobColor={hex}
          step={0.01}
          accessibilityLabel="Lightness"
          onChange={(value) => {
            setLightness(value)
            applyHsl(hue, value)
          }}
          renderTrack={() => (
            <Svg width="100%" height="100%">
              <Defs>
                <LinearGradient id="lightness-track" x1="0" y1="0" x2="1" y2="0">
                  <Stop offset="0" stopColor="#000000" />
                  <Stop offset={lightness} stopColor={hex} />
                  <Stop offset="1" stopColor="#ffffff" />
                </LinearGradient>
              </Defs>
              <Rect width="100%" height="100%" rx={7} fill="url(#lightness-track)" />
            </Svg>
          )}
        />
        <View style={s.contrastRow}>
          <Icon
            name={readable ? 'checkCircle' : 'alert'}
            size={18}
            color={readable ? palette.green : colors.coral}
          />
          <Text style={s.contrastText}>
            {readable
              ? `Readable with a contrast of ${contrast.toFixed(1)}:1`
              : `Low contrast (${contrast.toFixed(1)}:1)`}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Use this color"
          onPress={() => onPick(hex)}
          style={({ pressed }) => [
            s.useColorButton,
            { backgroundColor: hex },
            pressed && s.pressed,
          ]}
        >
          <Text style={[s.useColorText, { color: onColor(hex) }]}>Use this color</Text>
        </Pressable>
      </ScrollView>
    </BottomSheet>
  )
}
