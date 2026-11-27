package expo.modules.typoquicknote

import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import com.facebook.react.ReactActivity

open class QuickNoteActivity : ReactActivity() {
  override fun getMainComponentName(): String = "quickNote"

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(null)
    QuickSheets.register(getMainComponentName(), this)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
    } else {
      @Suppress("DEPRECATION")
      window.addFlags(
        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
          WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
      )
    }
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
