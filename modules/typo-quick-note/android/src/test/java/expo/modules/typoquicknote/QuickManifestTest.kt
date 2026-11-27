package expo.modules.typoquicknote

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

class QuickManifestTest {
  @Test
  fun quickSheetsCanOpenOverTheKeyguard() {
    val manifest = File("src/main/AndroidManifest.xml").readText()
    for (activity in listOf("QuickNoteActivity", "QuickAppendActivity")) {
      val block =
        manifest
          .substringAfter("android:name=\"expo.modules.typoquicknote.$activity\"")
          .substringBefore("/>")
      assertTrue(block.contains("android:showWhenLocked=\"true\""))
      assertTrue(block.contains("android:turnScreenOn=\"true\""))
    }
  }
}
