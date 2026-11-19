package expo.modules.typoquicknote

import android.app.ActivityOptions
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import java.io.File

abstract class QuickTileService : TileService() {
  protected abstract val availableLabel: Int
  protected abstract val unavailableLabel: Int
  protected abstract val component: String

  override fun onTileAdded() {
    super.onTileAdded()
    syncState()
  }

  // Non-active mode binds the service when the panel opens, which is where a
  // vault or target selected since the last open becomes visible.
  override fun onStartListening() {
    super.onStartListening()
    syncState()
  }

  override fun onClick() {
    super.onClick()
    if (!available()) return
    val activity =
      if (component == "quickAppend") QuickAppendActivity::class.java else QuickNoteActivity::class.java
    launch(Intent(this, activity))
  }

  protected open fun available(): Boolean = hasVault()

  private fun syncState() {
    val tile = qsTile ?: return
    val enabled = available()
    tile.state = if (enabled) Tile.STATE_INACTIVE else Tile.STATE_UNAVAILABLE
    tile.contentDescription = getString(
      if (enabled) availableLabel else unavailableLabel
    )
    tile.updateTile()
  }

  protected fun hasVault(): Boolean {
    // Mirrors selectionPath() in src/vault.ts, which the app owns.
    return selectionFile("typo-vault.json").let { it.isFile && it.length() > 0 }
  }

  protected fun hasQuickAppendTarget(): Boolean {
    // Mirrors configPath() in src/quick-append-config.ts.
    return selectionFile("typo-quick-append.json").let { it.isFile && it.length() > 0 }
  }

  private fun selectionFile(name: String): File = File(filesDir, name)

  private fun launch(intent: Intent) {
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      val pending = PendingIntent.getActivity(
        this,
        if (component == "quickAppend") 1 else 0,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        ActivityOptions.makeCustomAnimation(this, 0, 0).toBundle()
      )
      startActivityAndCollapse(pending)
    } else {
      @Suppress("DEPRECATION")
      startActivityAndCollapse(intent)
    }
  }
}
