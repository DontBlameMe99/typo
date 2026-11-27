import { requireOptionalNativeModule } from 'expo-modules-core'

type QuickSheetComponent = 'quickNote' | 'quickAppend'

type TypoQuickNoteModule = {
  finish(component: QuickSheetComponent): void
}

const nativeModule = requireOptionalNativeModule<TypoQuickNoteModule>('TypoQuickNote')

export function finishQuickNote(component: QuickSheetComponent): void {
  nativeModule?.finish(component)
}
