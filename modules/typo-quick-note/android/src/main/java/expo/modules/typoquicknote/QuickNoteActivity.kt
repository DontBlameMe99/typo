package expo.modules.typoquicknote

import android.os.Bundle
import com.facebook.react.ReactActivity

open class QuickNoteActivity : ReactActivity() {
  override fun getMainComponentName(): String = "quickNote"

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(null)
    QuickSheets.register(getMainComponentName(), this)
  }

  override fun onDestroy() {
    QuickSheets.unregister(getMainComponentName(), this)
    super.onDestroy()
  }

  // Back closes the popup instead of sending its task to the background.
  override fun invokeDefaultOnBackPressed() {
    finish()
  }
}
