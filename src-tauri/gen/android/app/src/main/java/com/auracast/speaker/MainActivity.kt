package com.auracast.speaker

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

class MainActivity : TauriActivity() {
  companion object {
    private const val REQUEST_MICROPHONE = 1
  }

  private var multicastLock: WifiManager.MulticastLock? = null
  private var webView: WebView? = null
  private var pendingMicrophone: ((Boolean) -> Unit)? = null

  // The "start recording or casting" consent screen for system audio
  private val projectionConsent = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
    val data = result.data
    if (result.resultCode == RESULT_OK && data != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      SystemAudioService.start(this, result.resultCode, data)
      resolve("system", true)
    } else {
      resolve("system", false)
    }
  }

  // Implemented in src-tauri/src/android.rs: hands the JVM and Context to cpal (via ndk-context)
  private external fun initAudioContext(context: Context)

  override fun onCreate(savedInstanceState: Bundle?) {
    // Before Tauri starts, so the UI can never query audio devices before cpal is ready
    System.loadLibrary("auracast_lib")
    initAudioContext(applicationContext)

    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // Without this lock many devices filter out the multicast packets mDNS discovery relies on
    val wifi = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
    multicastLock = wifi.createMulticastLock("auracast-discovery").apply {
      setReferenceCounted(false)
      acquire()
    }
  }

  override fun onWebViewCreate(webView: WebView) {
    this.webView = webView
    webView.addJavascriptInterface(Bridge(), "AuraCastAndroid")
  }

  /**
   * Called from the web UI (src/lib/android.ts). Each request answers
   * asynchronously through `window.__auracastAndroid.resolve(kind, ok)`.
   */
  inner class Bridge {
    @JavascriptInterface
    fun requestMicrophone() = runOnUiThread {
      withMicrophone { granted -> resolve("mic", granted) }
    }

    @JavascriptInterface
    fun startSystemAudio() = runOnUiThread {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
        resolve("system", false)
        return@runOnUiThread
      }
      // Playback capture also requires the record-audio permission
      withMicrophone { granted ->
        if (!granted) {
          resolve("system", false)
        } else {
          val manager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
          projectionConsent.launch(manager.createScreenCaptureIntent())
        }
      }
    }

    @JavascriptInterface
    fun stopSystemAudio() = runOnUiThread {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) SystemAudioService.stop(this@MainActivity)
    }
  }

  /** Ask for RECORD_AUDIO only when a broadcast actually needs it. */
  private fun withMicrophone(then: (Boolean) -> Unit) {
    if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
      then(true)
      return
    }
    pendingMicrophone = then
    ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.RECORD_AUDIO), REQUEST_MICROPHONE)
  }

  override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    if (requestCode == REQUEST_MICROPHONE) {
      val callback = pendingMicrophone
      pendingMicrophone = null
      callback?.invoke(grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED)
    }
  }

  private fun resolve(kind: String, ok: Boolean) {
    webView?.post {
      webView?.evaluateJavascript("window.__auracastAndroid && window.__auracastAndroid.resolve('$kind', $ok)", null)
    }
  }

  override fun onDestroy() {
    multicastLock?.release()
    super.onDestroy()
  }
}
