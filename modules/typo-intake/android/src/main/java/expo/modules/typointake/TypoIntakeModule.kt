package expo.modules.typointake

import android.content.Intent
import android.net.Uri
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileNotFoundException
import java.io.InputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class TypoIntakeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("TypoIntake")

    Events("onIntent")

    Function("getInitialIntent") {
      appContext.currentActivity?.intent?.let { payload(it) }
    }

    AsyncFunction("readText") Coroutine { uriString: String, maxBytes: Long ->
      withContext(Dispatchers.IO.limitedParallelism(1)) {
        require(maxBytes in 0..Int.MAX_VALUE.toLong()) { "Invalid file read limit." }
        val uri = Uri.parse(uriString)
        require(uri.scheme == "content" || uri.scheme == "file") { "Unsupported file URI." }
        val output = ByteArrayOutputStream(16 * 1024)
        input(uri).use { input ->
          val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
          var remaining = maxBytes
          while (true) {
            val count = input.read(buffer, 0, minOf(buffer.size.toLong(), remaining + 1).toInt())
            if (count < 0) break
            if (count > remaining) {
              throw CodedException("ERR_TYPO_INTAKE_LIMIT", "The shared file is too large.", null)
            }
            output.write(buffer, 0, count)
            remaining -= count
          }
        }
        output.toString("UTF-8")
      }
    }

    OnNewIntent { intent ->
      payload(intent)?.let { sendEvent("onIntent", it) }
    }
  }

  private fun input(uri: Uri): InputStream {
    val resolver = (appContext.reactContext ?: throw Exceptions.AppContextLost()).contentResolver
    resolver.openInputStream(uri)?.let { return it }
    if (uri.scheme == "file" && uri.path != null) return File(uri.path!!).inputStream()
    throw FileNotFoundException("The shared file could not be opened.")
  }

  private fun displayName(uri: Uri): String? = uri.lastPathSegment

  @Suppress("DEPRECATION")
  private fun payload(intent: Intent): Map<String, Any?>? {
    val action = intent.action ?: return null
    if (action != Intent.ACTION_VIEW && action != Intent.ACTION_SEND) return null
    val data = intent.data
    // typo:// links are handled by React Native Linking in App.tsx.
    if (data?.scheme == "typo") return null
    val uri = if (action == Intent.ACTION_SEND) {
      @Suppress("UNCHECKED_CAST")
      (intent.getParcelableExtra(Intent.EXTRA_STREAM) as? Uri)?.toString()
    } else {
      data?.toString()
    }
    val name = uri?.let { displayName(Uri.parse(it)) }
    return mapOf(
      "action" to action,
      "url" to uri,
      "type" to intent.type,
      "text" to intent.getStringExtra(Intent.EXTRA_TEXT),
      "subject" to intent.getStringExtra(Intent.EXTRA_SUBJECT),
      "name" to name
    )
  }
}
