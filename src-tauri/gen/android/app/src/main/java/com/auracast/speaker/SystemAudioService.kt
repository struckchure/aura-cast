package com.auracast.speaker

import android.annotation.SuppressLint
import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.annotation.RequiresApi

/**
 * Captures what other apps are playing (Android 10+ playback capture) and
 * hands it to the Rust sender as 48 kHz stereo float PCM.
 *
 * Android only allows this from a foreground service holding a MediaProjection
 * the user consented to, so the service also shows the "sharing audio"
 * notification (which keeps sharing alive while the app is in the background).
 */
@RequiresApi(Build.VERSION_CODES.Q)
class SystemAudioService : Service() {
  companion object {
    const val EXTRA_RESULT_CODE = "resultCode"
    const val EXTRA_RESULT_DATA = "resultData"
    private const val CHANNEL_ID = "system-audio"
    private const val NOTIFICATION_ID = 1
    private const val SAMPLE_RATE = 48_000
    private const val TAG = "AuraCast"

    fun start(context: Context, resultCode: Int, data: Intent) {
      val intent = Intent(context, SystemAudioService::class.java)
        .putExtra(EXTRA_RESULT_CODE, resultCode)
        .putExtra(EXTRA_RESULT_DATA, data)
      context.startForegroundService(intent)
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, SystemAudioService::class.java))
    }
  }

  /** Implemented in src-tauri/src/android.rs */
  private external fun pushAudio(samples: FloatArray, len: Int)

  private var projection: MediaProjection? = null
  private var record: AudioRecord? = null
  @Volatile private var running = false

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // Must be in the foreground before asking for the projection (Android 14+)
    startForegroundCompat()

    val resultCode = intent?.getIntExtra(EXTRA_RESULT_CODE, Activity.RESULT_CANCELED) ?: Activity.RESULT_CANCELED
    @Suppress("DEPRECATION")
    val data: Intent? = intent?.getParcelableExtra(EXTRA_RESULT_DATA)
    if (resultCode != Activity.RESULT_OK || data == null || running) {
      if (!running) stopSelf()
      return START_NOT_STICKY
    }

    try {
      val manager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
      val projection = manager.getMediaProjection(resultCode, data)
      if (projection == null) {
        stopSelf()
        return START_NOT_STICKY
      }
      // Required before capturing on Android 14+; also stop if the user revokes sharing
      projection.registerCallback(object : MediaProjection.Callback() {
        override fun onStop() {
          stopSelf()
        }
      }, Handler(Looper.getMainLooper()))
      this.projection = projection
      startCapture(projection)
    } catch (e: Exception) {
      Log.e(TAG, "Could not start system audio capture", e)
      stopSelf()
    }
    return START_NOT_STICKY
  }

  // RECORD_AUDIO is granted by MainActivity before this service is started
  @SuppressLint("MissingPermission")
  private fun startCapture(projection: MediaProjection) {
    val config = AudioPlaybackCaptureConfiguration.Builder(projection)
      .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
      .addMatchingUsage(AudioAttributes.USAGE_GAME)
      .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
      .build()
    val format = AudioFormat.Builder()
      .setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
      .setSampleRate(SAMPLE_RATE)
      .setChannelMask(AudioFormat.CHANNEL_IN_STEREO)
      .build()
    val minBuffer = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_STEREO, AudioFormat.ENCODING_PCM_FLOAT)
    val record = AudioRecord.Builder()
      .setAudioFormat(format)
      .setAudioPlaybackCaptureConfig(config)
      .setBufferSizeInBytes(maxOf(minBuffer, SAMPLE_RATE / 5 * 2 * 4))
      .build()
    this.record = record
    record.startRecording()
    running = true

    Thread({
      // 10 ms of stereo audio per read
      val buffer = FloatArray(SAMPLE_RATE / 100 * 2)
      while (running) {
        val read = record.read(buffer, 0, buffer.size, AudioRecord.READ_BLOCKING)
        if (read > 0) pushAudio(buffer, read)
      }
    }, "auracast-system-audio").start()
  }

  private fun startForegroundCompat() {
    val manager = getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, "Sharing system audio", NotificationManager.IMPORTANCE_LOW)
    )
    val openApp = PendingIntent.getActivity(
      this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE
    )
    val notification = Notification.Builder(this, CHANNEL_ID)
      .setContentTitle("AuraCast is sharing this phone's audio")
      .setContentText("Open AuraCast to stop broadcasting")
      .setSmallIcon(android.R.drawable.ic_lock_silent_mode_off)
      .setContentIntent(openApp)
      .setOngoing(true)
      .build()
    startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
  }

  override fun onDestroy() {
    running = false
    record?.let {
      try {
        it.stop()
      } catch (_: IllegalStateException) {
      }
      it.release()
    }
    record = null
    projection?.stop()
    projection = null
    super.onDestroy()
  }
}
