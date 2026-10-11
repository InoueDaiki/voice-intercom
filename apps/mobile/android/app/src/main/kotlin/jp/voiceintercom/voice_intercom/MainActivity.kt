package jp.voiceintercom.voice_intercom

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        // 入室中のフォアグラウンドサービス(lib/room/background_audio.dart)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "voiceintercom/in_room")
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "start" -> {
                        requestNotificationPermission()
                        try {
                            val withMic = InRoomService.start(this, call.argument<String>("title") ?: "入室中")
                            result.success(withMic)
                        } catch (e: Exception) {
                            // Android 12 以降、バックグラウンドからは始められない
                            result.error("start_failed", e.toString(), null)
                        }
                    }
                    "stop" -> {
                        InRoomService.stop(this)
                        result.success(null)
                    }
                    else -> result.notImplemented()
                }
            }
    }

    override fun cleanUpFlutterEngine(flutterEngine: FlutterEngine) {
        // アプリの終了でエンジンが外れると、ルームの接続(Dart)も flutter_webrtc の音声も破棄される。
        // サービスだけが残らないよう、ここでも止める
        InRoomService.stop(this)
        super.cleanUpFlutterEngine(flutterEngine)
    }

    /**
     * 入室中の通知を出すための権限(Android 13 以降)。無くてもサービスは動くが、通知が出ない。
     * 結果は待たない。
     */
    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 0)
        }
    }
}
