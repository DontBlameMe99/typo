package expo.modules.typoquicknote

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class TypoQuickNoteModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("TypoQuickNote")

    Function("finish") { component: String? ->
      QuickSheets.finish(component, appContext.currentActivity as? QuickNoteActivity)
    }
  }
}
