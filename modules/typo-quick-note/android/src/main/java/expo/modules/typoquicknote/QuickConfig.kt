package expo.modules.typoquicknote

import android.content.Context
import java.io.File
import org.json.JSONObject

object QuickConfig {
  const val VAULT_FILE = "typo-vault.json"
  const val APPEND_FILE = "typo-quick-append.json"
  private const val MAX_CONFIG_BYTES = 16 * 1024

  data class Vault(val uri: String)
  data class Append(val vaultUri: String, val notePath: String, val section: String)
  data class Grant(val uri: String, val canRead: Boolean, val canWrite: Boolean)
  data class Availability(val canCreate: Boolean, val canAppend: Boolean)

  fun availability(directory: File, grants: List<Grant>): Availability {
    val vault = vault(directory) ?: return Availability(false, false)
    if (!hasPermission(vault.uri, grants)) return Availability(false, false)
    val target = append(directory)
    return Availability(true, target != null && target.vaultUri == vault.uri)
  }

  fun persistedGrants(context: Context): List<Grant> =
    context.contentResolver.persistedUriPermissions.map {
      Grant(
        it.uri.toString(),
        it.isReadPermission,
        it.isWritePermission
      )
    }

  internal fun vault(directory: File): Vault? =
    read(directory, VAULT_FILE) { json ->
      val uri = json.optString("uri")
      if (isVaultUri(uri)) Vault(uri) else null
    }

  internal fun append(directory: File): Append? =
    read(directory, APPEND_FILE) { json ->
      val vaultUri = json.optString("vaultUri")
      val notePath = json.optString("notePath")
      val section = json.optString("section").trim()
      if (
        isVaultUri(vaultUri) &&
          validNotePath(notePath) &&
          section.isNotEmpty() &&
          !section.contains('\n') &&
          !section.contains('\r')
      ) {
        Append(vaultUri, notePath, section)
      } else {
        null
      }
    }

  internal fun hasPermission(vaultUri: String, grants: List<Grant>): Boolean =
    grants.any { it.uri == vaultUri && it.canRead && it.canWrite }

  internal fun isVaultUri(value: String): Boolean =
    value.startsWith("content://com.android.externalstorage.documents/tree/") &&
      value.substringAfter("/tree/").isNotEmpty()

  private fun validNotePath(path: String): Boolean =
    path.isNotEmpty() &&
      !path.startsWith('/') &&
      !path.contains('\\') &&
      path.endsWith(".typ", ignoreCase = true) &&
      path.split('/').none { it.isEmpty() || it == "." || it == ".." }

  private inline fun <T> read(directory: File, name: String, decode: (JSONObject) -> T?): T? {
    val file = File(directory, name)
    if (!file.isFile || file.length() > MAX_CONFIG_BYTES) return null
    return try {
      decode(JSONObject(file.readText(Charsets.UTF_8)))
    } catch (_: Exception) {
      null
    }
  }
}
