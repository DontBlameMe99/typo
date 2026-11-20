package expo.modules.typoquicknote

class QuickNoteTileService : QuickTileService() {
  override val availableLabel = R.string.typo_quick_note_tile
  override val unavailableLabel = R.string.typo_quick_note_tile_unavailable
  override val component = "quickNote"
}
