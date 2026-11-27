package expo.modules.typoquicknote

class QuickAppendTileService : QuickTileService() {
  override val availableLabel = R.string.typo_quick_append_tile
  override val unavailableLabel = R.string.typo_quick_append_tile_unavailable
  override val component = "quickAppend"

  override fun available(): Boolean =
    QuickConfig.availability(filesDir, QuickConfig.persistedGrants(this)).canAppend
}
