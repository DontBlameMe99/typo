package expo.modules.typovault

import java.nio.charset.CharacterCodingException
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class TypoVaultModuleTest {
  @Test
  fun strictUtf8DecodingRejectsMalformedBytes() {
    assertTrue(TypoVaultModule.decodeUtf8("Grüße ☃".toByteArray(Charsets.UTF_8)) == "Grüße ☃")
    assertThrows(CharacterCodingException::class.java) {
      TypoVaultModule.decodeUtf8(byteArrayOf(0xC3.toByte()))
    }
    assertThrows(CharacterCodingException::class.java) {
      TypoVaultModule.decodeUtf8(byteArrayOf(0xFF.toByte()))
    }
  }

  @Test
  fun vaultUriAcceptsOnlyLocalTreeUris() {
    assertTrue(
      TypoVaultModule.isVaultUri(
        "content://com.android.externalstorage.documents/tree/primary%3ADemo"
      )
    )
    assertTrue(
      TypoVaultModule.isVaultUri(
        "content://com.android.externalstorage.documents/tree/primary%3ADemo/document/primary%3ADemo%2Fnotes%2FDemo.typ"
      )
    )
    assertFalse(TypoVaultModule.isVaultUri("content://com.android.externalstorage.documents/tree/"))
    assertFalse(TypoVaultModule.isVaultUri("content://cloud.android.documents/tree/Demo"))
    assertFalse(TypoVaultModule.isVaultUri("file:///storage/emulated/0/Demo"))
    assertFalse(
      TypoVaultModule.isVaultUri(
        "content://com.android.externalstorage.documents/tree/primary%3ADemo/document/"
      )
    )
  }
}
