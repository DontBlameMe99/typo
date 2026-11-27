package expo.modules.typoquicknote

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class QuickConfigTest {
  @get:Rule val folder = TemporaryFolder()

  @Test
  fun vaultConfigRequiresAPersistedTreeUriShape() {
    val uri = "content://com.android.externalstorage.documents/tree/primary%3ADemo"
    put(QuickConfig.VAULT_FILE, """{"uri":"$uri","name":"Demo"}""")
    assertEquals(uri, QuickConfig.vault(folder.root)?.uri)

    put(QuickConfig.VAULT_FILE, """{"uri":"content://cloud.android/tree/Demo","name":"Demo"}""")
    assertNull(QuickConfig.vault(folder.root))
    put(QuickConfig.VAULT_FILE, "not json")
    assertNull(QuickConfig.vault(folder.root))
    put(QuickConfig.VAULT_FILE, "{\"uri\":\"$uri\"}".padEnd(20 * 1024, ' '))
    assertNull(QuickConfig.vault(folder.root))
  }

  @Test
  fun appendConfigRejectsInvalidTargets() {
    val uri = "content://com.android.externalstorage.documents/tree/primary%3ADemo"
    put(
      QuickConfig.APPEND_FILE,
      """{"vaultUri":"$uri","notePath":"notes/Demo.typ","section":" Inbox "}"""
    )
    assertEquals(
      QuickConfig.Append(uri, "notes/Demo.typ", "Inbox"),
      QuickConfig.append(folder.root)
    )

    put(
      QuickConfig.APPEND_FILE,
      """{"vaultUri":"$uri","notePath":"../Demo.typ","section":"Inbox"}"""
    )
    assertNull(QuickConfig.append(folder.root))
    put(
      QuickConfig.APPEND_FILE,
      """{"vaultUri":"$uri","notePath":"notes/Demo.md","section":"Inbox"}"""
    )
    assertNull(QuickConfig.append(folder.root))
    put(
      QuickConfig.APPEND_FILE,
      """{"vaultUri":"$uri","notePath":"notes/Demo.typ","section":"Inbox\nMore"}"""
    )
    assertNull(QuickConfig.append(folder.root))
  }

  @Test
  fun availabilityNeedsPermissionAndMatchingTarget() {
    val uri = "content://com.android.externalstorage.documents/tree/primary%3ADemo"
    val other = "content://com.android.externalstorage.documents/tree/primary%3AOther"
    put(QuickConfig.VAULT_FILE, """{"uri":"$uri","name":"Demo"}""")
    put(
      QuickConfig.APPEND_FILE,
      """{"vaultUri":"$uri","notePath":"notes/Demo.typ","section":"Inbox"}"""
    )

    assertFalse(QuickConfig.availability(folder.root, emptyList()).canCreate)
    assertFalse(
      QuickConfig.availability(folder.root, listOf(QuickConfig.Grant(uri, true, false))).canCreate
    )
    val ready = QuickConfig.availability(folder.root, listOf(QuickConfig.Grant(uri, true, true)))
    assertTrue(ready.canCreate)
    assertTrue(ready.canAppend)

    put(
      QuickConfig.APPEND_FILE,
      """{"vaultUri":"$other","notePath":"notes/Demo.typ","section":"Inbox"}"""
    )
    val wrongTarget =
      QuickConfig.availability(folder.root, listOf(QuickConfig.Grant(uri, true, true)))
    assertTrue(wrongTarget.canCreate)
    assertFalse(wrongTarget.canAppend)
  }

  @Test
  fun configNamesMatchTheTypeScriptSources() {
    val root =
      generateSequence(File(".").absoluteFile) { it.parentFile }
        .first { File(it, "src/vault.ts").isFile }
    val vault = File(root, "src/vault.ts").readText()
    val append = File(root, "src/quick-append-config.ts").readText()
    assertTrue(
      vault.contains("return `\${FileSystem.documentDirectory}${QuickConfig.VAULT_FILE}`")
    )
    assertTrue(
      append.contains("return `\${FileSystem.documentDirectory}${QuickConfig.APPEND_FILE}`")
    )
  }

  private fun put(name: String, text: String) {
    File(folder.root, name).writeText(text)
  }
}
