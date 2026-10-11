package jp.voiceintercom.voice_intercom

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log

/**
 * 入室している間だけ動かすフォアグラウンドサービス。アプリがバックグラウンドにいても、
 * マイク(送信)と再生(受信)を OS に止められないようにする(設計メモの「バックグラウンドでの音声」)。
 *
 * サービス自体は何もしない。音声は LiveKit(flutter_webrtc)が同じプロセスで扱い、
 * このサービスはプロセスとマイクの利用を「フォアグラウンド」扱いにするためだけにある。
 *
 * - 種類は、マイクの権限があれば microphone と mediaPlayback、なければ mediaPlayback だけ(受信だけ)。
 * - Android 14 以降は、バックグラウンドから microphone のサービスを新しく始められないので、
 *   入室の時点(フォアグラウンド)で始める。
 * - タスクを消されたら止める。Flutter のエンジンが外れるとき(MainActivity)にも止める。
 */
class InRoomService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val title = intent?.getStringExtra(EXTRA_TITLE) ?: "入室中"
        val notification = buildNotification(title)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            try {
                startForeground(NOTIFICATION_ID, notification, serviceTypes(this))
            } catch (e: SecurityException) {
                // 呼んだ時点で裏に回っていたなど、microphone の種類が許されなかった。startForeground を
                // 呼ばずに終わるとアプリが落ちるので、受信だけで始める
                Log.w(TAG, "マイクのフォアグラウンドサービスを始められなかった。受信だけにする", e)
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
            }
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        // プロセスが落ちたら、つなぎ直さない(ルームの接続は Dart 側にあり、作り直せない)
        return START_NOT_STICKY
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        stopSelf()
        super.onTaskRemoved(rootIntent)
    }

    private fun buildNotification(title: String): Notification {
        val manager = getSystemService(NotificationManager::class.java)
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID,
                    "入室中",
                    // 音もバイブも要らない。入室中であることが分かればよい
                    NotificationManager.IMPORTANCE_LOW,
                ).apply { description = "ルームに入っている間に表示します" },
            )
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
        // 通知を押したらアプリに戻る
        val open = PendingIntent.getActivity(
            this,
            0,
            packageManager.getLaunchIntentForPackage(packageName),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return builder
            .setSmallIcon(R.drawable.ic_in_room)
            .setContentTitle(title)
            .setContentText("バックグラウンドでも音声を送受信します")
            .setContentIntent(open)
            .setOngoing(true)
            .setCategory(Notification.CATEGORY_CALL)
            .build()
    }

    companion object {
        private const val TAG = "InRoomService"
        private const val CHANNEL_ID = "in_room"
        private const val NOTIFICATION_ID = 1
        private const val EXTRA_TITLE = "title"

        private fun hasMicPermission(context: Context) =
            context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) ==
                PackageManager.PERMISSION_GRANTED

        private fun serviceTypes(context: Context): Int {
            var types = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
            // microphone の種類は Android 11(R)から。権限が無いのに付けると、Android 14 以降は例外になる
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && hasMicPermission(context)) {
                types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            }
            return types
        }

        /**
         * サービスを始める。始めたら、マイクを含むかどうかを返す。
         * バックグラウンドからなど、OS が許さないときは例外を投げる。
         */
        fun start(context: Context, title: String): Boolean {
            val intent = Intent(context, InRoomService::class.java).putExtra(EXTRA_TITLE, title)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
            return Build.VERSION.SDK_INT < Build.VERSION_CODES.R || hasMicPermission(context)
        }

        fun stop(context: Context) {
            try {
                context.stopService(Intent(context, InRoomService::class.java))
            } catch (e: Exception) {
                Log.w(TAG, "サービスを止められなかった", e)
            }
        }
    }
}
