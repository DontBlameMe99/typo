package expo.modules.typoquicknote

import java.lang.ref.WeakReference

object QuickSheets {
  private val sheets = mutableMapOf<String, WeakReference<QuickNoteActivity>>()

  @Synchronized
  fun register(component: String, activity: QuickNoteActivity) {
    sheets[component] = WeakReference(activity)
  }

  @Synchronized
  fun unregister(component: String, activity: QuickNoteActivity) {
    if (sheets[component]?.get() === activity) sheets.remove(component)
  }

  fun finish(component: String?, currentActivity: QuickNoteActivity? = null) {
    val sheet =
      if (component != null) {
        synchronized(this) { sheets[component]?.get() }
      } else {
        currentActivity
      }
    sheet?.finish()
  }
}
