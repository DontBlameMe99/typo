package expo.modules.typoquicknote

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class QuickSheetsTest {
  private class TestSheet : QuickNoteActivity() {
    var finished = false

    override fun finish() {
      finished = true
    }
  }

  @Test
  fun finishesOnlyTheRequestedSheet() {
    val note = TestSheet()
    val append = TestSheet()
    QuickSheets.register("quickNote", note)
    QuickSheets.register("quickAppend", append)

    QuickSheets.finish("quickNote")

    assertTrue(note.finished)
    assertFalse(append.finished)
  }

  @Test
  fun fallbackFinishesOnlyTheGivenActivity() {
    val note = TestSheet()
    val append = TestSheet()
    QuickSheets.register("quickNote", note)
    QuickSheets.register("quickAppend", append)

    QuickSheets.finish(null, append)

    assertFalse(note.finished)
    assertTrue(append.finished)
  }

  @Test
  fun missingComponentDoesNotUseTheResumedSheet() {
    val note = TestSheet()
    val append = TestSheet()
    QuickSheets.register("quickAppend", append)

    QuickSheets.finish("quickNote", note)

    assertFalse(note.finished)
    assertFalse(append.finished)
  }
}
