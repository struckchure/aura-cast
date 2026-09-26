package com.auracast.speaker

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.wifi.WifiManager
import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

class MainActivity : TauriActivity() {
  private var multicastLock: WifiManager.MulticastLock? = null

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

    // Needed before the Rust side can open the microphone for broadcasting
    if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.RECORD_AUDIO), 1)
    }
  }

  override fun onDestroy() {
    multicastLock?.release()
    super.onDestroy()
  }
}
