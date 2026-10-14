package jp.voiceintercom.voice_intercom

import android.content.Context
import android.graphics.Bitmap
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.transformer.AudioEncoderSettings
import androidx.media3.transformer.Composition
import androidx.media3.transformer.DefaultEncoderFactory
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.EditedMediaItemSequence
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.InAppMp4Muxer
import androidx.media3.transformer.ProgressHolder
import androidx.media3.transformer.Transformer
import androidx.media3.transformer.VideoEncoderSettings
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.concurrent.Executors
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * 動画を測り、H.264 の MP4 にし、フレームを取り出す(lib/media/video_transcoder.dart)。
 *
 * - 符号化し直すとき: Media3 Transformer。解像度・フレームレート・回転は元のまま、映像のビットレートは
 *   Dart から渡された値。HDR は OpenGL のトーンマップで SDR にする。音声は AAC(元が AAC ならそのまま)。
 * - 入れ直すだけのとき(videoBitrate が null): Transformer が符号化せずに入れ直す。
 * - どちらも InAppMp4Muxer(Media3 の Mp4Muxer)で書き、moov を先頭に置く
 *   (MediaMuxer は moov を末尾に置く)。
 */
@OptIn(UnstableApi::class)
class VideoTranscoder(private val context: Context, messenger: BinaryMessenger) :
    MethodChannel.MethodCallHandler {
    private val channel = MethodChannel(messenger, "voiceintercom/video")
    private val executor = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())

    init {
        channel.setMethodCallHandler(this)
    }

    fun dispose() {
        channel.setMethodCallHandler(null)
        executor.shutdown()
    }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        val path = call.argument<String>("path")
        if (path == null) {
            result.error("bad_args", "path が無い", null)
            return
        }
        when (call.method) {
            "probe" -> background(result) { probe(path) }
            "frame" -> background(result) { frame(path, call.argument<Int>("maxSide") ?: 960) }
            "transcode" -> {
                val outPath = call.argument<String>("outPath")
                if (outPath == null) {
                    result.error("bad_args", "outPath が無い", null)
                    return
                }
                val bitrate = call.argument<Number>("videoBitrate")?.toInt()
                transcode(path, outPath, bitrate, result)
            }
            else -> result.notImplemented()
        }
    }

    private fun background(result: MethodChannel.Result, work: () -> Any?) {
        executor.execute {
            try {
                val value = work()
                main.post { result.success(value) }
            } catch (e: Exception) {
                main.post { result.error("failed", e.toString(), null) }
            }
        }
    }

    /** 幅・高さは符号化された画素(回転の前)、rotation は表示のときの時計回りの回転 */
    private fun probe(path: String): Map<String, Any?> {
        val info = mutableMapOf<String, Any?>()
        val retriever = MediaMetadataRetriever()
        try {
            retriever.setDataSource(path)
            fun key(k: Int) = retriever.extractMetadata(k)
            if (key(MediaMetadataRetriever.METADATA_KEY_HAS_VIDEO) != "yes") {
                throw IllegalArgumentException("動画のトラックが無い")
            }
            info["width"] = key(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull()
            info["height"] = key(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull()
            info["rotation"] = key(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
            val durationMs = key(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()
            info["durationMs"] = durationMs
            info["totalBitrate"] = key(MediaMetadataRetriever.METADATA_KEY_BITRATE)?.toLongOrNull()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && durationMs != null && durationMs > 0) {
                key(MediaMetadataRetriever.METADATA_KEY_VIDEO_FRAME_COUNT)?.toLongOrNull()?.let {
                    info["frameRate"] = it * 1000.0 / durationMs
                }
            }
        } finally {
            retriever.release()
        }
        val extractor = MediaExtractor()
        try {
            extractor.setDataSource(path)
            for (i in 0 until extractor.trackCount) {
                val format = extractor.getTrackFormat(i)
                val mime = format.getString(MediaFormat.KEY_MIME) ?: continue
                if (mime.startsWith("video/") && !info.containsKey("videoCodec")) {
                    info["videoCodec"] = codecName(mime)
                    numberOf(format, MediaFormat.KEY_FRAME_RATE)?.let { info["frameRate"] = it.toDouble() }
                    numberOf(format, MediaFormat.KEY_BIT_RATE)?.let { info["videoBitrate"] = it.toLong() }
                } else if (mime.startsWith("audio/") && !info.containsKey("audioCodec")) {
                    info["audioCodec"] = codecName(mime)
                    numberOf(format, MediaFormat.KEY_CHANNEL_COUNT)?.let { info["audioChannels"] = it.toInt() }
                    numberOf(format, MediaFormat.KEY_BIT_RATE)?.let { info["audioBitrate"] = it.toLong() }
                }
            }
        } finally {
            extractor.release()
        }
        // 映像のビットレートが箱に無ければ、全体から音声の分を引く(音声のビットレートが分からなければ 128kbps とみなす)
        if (info["videoBitrate"] == null) {
            val total = info["totalBitrate"] as Long?
            if (total != null && total > 0) {
                val audio = if (info["audioCodec"] != null) (info["audioBitrate"] as Long? ?: 128_000L) else 0L
                info["videoBitrate"] = max(total - audio, total / 2)
            }
        }
        info.remove("totalBitrate")
        info.remove("audioBitrate")
        return info
    }

    private fun numberOf(format: MediaFormat, key: String): Number? {
        if (!format.containsKey(key)) return null
        return try {
            format.getInteger(key)
        } catch (e: ClassCastException) {
            try {
                format.getFloat(key)
            } catch (e: ClassCastException) {
                null
            }
        }
    }

    private fun codecName(mime: String): String = when (mime) {
        MimeTypes.VIDEO_H264 -> "h264"
        MimeTypes.VIDEO_H265 -> "hevc"
        MimeTypes.AUDIO_AAC -> "aac"
        else -> mime.substringAfter('/')
    }

    /** 向きを反映したフレーム(JPEG) */
    private fun frame(path: String, maxSide: Int): ByteArray? {
        val retriever = MediaMetadataRetriever()
        try {
            retriever.setDataSource(path)
            val bitmap = retriever.getFrameAtTime(0, MediaMetadataRetriever.OPTION_CLOSEST_SYNC) ?: return null
            val scale = maxSide.toFloat() / max(bitmap.width, bitmap.height)
            val scaled = if (scale < 1) {
                Bitmap.createScaledBitmap(
                    bitmap,
                    (bitmap.width * scale).roundToInt().coerceAtLeast(1),
                    (bitmap.height * scale).roundToInt().coerceAtLeast(1),
                    true,
                )
            } else {
                bitmap
            }
            val out = ByteArrayOutputStream()
            scaled.compress(Bitmap.CompressFormat.JPEG, 80, out)
            return out.toByteArray()
        } finally {
            retriever.release()
        }
    }

    private fun transcode(path: String, outPath: String, videoBitrate: Int?, result: MethodChannel.Result) {
        if (videoBitrate == null) {
            // 入れ直すだけ(HDR の扱いは変えない)
            export(path, outPath, null, null, result::success) { e ->
                result.error("transcode_failed", e.toString(), null)
            }
            return
        }
        // HDR を SDR にする方法。OpenGL のトーンマップは端末の GPU 次第で失敗する(エミュレーターでは失敗した)ので、
        // 失敗したら MediaCodec のトーンマップ(Android 12 以降)、最後は HDR を SDR とみなして(色は浅くなる)符号化する
        val modes = buildList {
            add(Composition.HDR_MODE_TONE_MAP_HDR_TO_SDR_USING_OPEN_GL)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                add(Composition.HDR_MODE_TONE_MAP_HDR_TO_SDR_USING_MEDIACODEC)
            }
            add(Composition.HDR_MODE_EXPERIMENTAL_FORCE_INTERPRET_HDR_AS_SDR)
        }
        fun attempt(index: Int) {
            export(path, outPath, videoBitrate, modes[index], result::success) { e ->
                if (index + 1 < modes.size) {
                    android.util.Log.w("VideoTranscoder", "HDR の扱い ${modes[index]} で失敗したので次を試す", e)
                    attempt(index + 1)
                } else {
                    result.error("transcode_failed", e.toString(), null)
                }
            }
        }
        attempt(0)
    }

    private fun export(
        path: String,
        outPath: String,
        videoBitrate: Int?,
        hdrMode: Int?,
        onDone: (Any?) -> Unit,
        onError: (ExportException) -> Unit,
    ) {
        File(outPath).delete()
        val encoderFactory = DefaultEncoderFactory.Builder(context).setEnableFallback(true)
        if (videoBitrate != null) {
            encoderFactory
                .setRequestedVideoEncoderSettings(
                    VideoEncoderSettings.Builder().setBitrate(videoBitrate).build(),
                )
                .setRequestedAudioEncoderSettings(
                    // iOS と合わせる(1チャンネルあたり 96kbps。2チャンネルとみなす)
                    AudioEncoderSettings.Builder().setBitrate(192_000).build(),
                )
        }
        val progressHolder = ProgressHolder()
        var lastSent = -1
        lateinit var transformer: Transformer
        val poll = object : Runnable {
            override fun run() {
                if (transformer.getProgress(progressHolder) == Transformer.PROGRESS_STATE_AVAILABLE &&
                    progressHolder.progress != lastSent
                ) {
                    lastSent = progressHolder.progress
                    channel.invokeMethod("progress", lastSent / 100.0)
                }
                main.postDelayed(this, 200)
            }
        }
        transformer = Transformer.Builder(context)
            .setVideoMimeType(MimeTypes.VIDEO_H264)
            .setAudioMimeType(MimeTypes.AUDIO_AAC)
            .setEncoderFactory(encoderFactory.build())
            .setMuxerFactory(InAppMp4Muxer.Factory())
            .addListener(object : Transformer.Listener {
                override fun onCompleted(composition: Composition, exportResult: ExportResult) {
                    main.removeCallbacks(poll)
                    channel.invokeMethod("progress", 1.0)
                    onDone(null)
                }

                override fun onError(
                    composition: Composition,
                    exportResult: ExportResult,
                    exportException: ExportException,
                ) {
                    main.removeCallbacks(poll)
                    File(outPath).delete()
                    onError(exportException)
                }
            })
            .build()
        val item = EditedMediaItem.Builder(MediaItem.fromUri(Uri.fromFile(File(path)))).build()
        val composition = Composition.Builder(EditedMediaItemSequence.Builder(item).build())
            .apply { hdrMode?.let { setHdrMode(it) } }
            .build()
        transformer.start(composition, outPath)
        main.postDelayed(poll, 200)
    }
}
