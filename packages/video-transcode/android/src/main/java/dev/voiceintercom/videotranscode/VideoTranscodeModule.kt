package dev.voiceintercom.videotranscode

import android.content.Context
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.transformer.Composition
import androidx.media3.transformer.DefaultEncoderFactory
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.ProgressHolder
import androidx.media3.transformer.Transformer
import androidx.media3.transformer.VideoEncoderSettings
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.UUID

// 進み具合を読む間隔(ミリ秒)
private const val PROGRESS_INTERVAL_MS = 200L

class VideoTranscodeModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw CodedException("ERR_NO_CONTEXT", "Android の Context が無い", null)

  private val mainHandler = Handler(Looper.getMainLooper())
  // 動いている変換(1つずつ。MediaUploader が順に送る)。触るのはメインスレッドだけ
  private var running: Job? = null

  private class Job(val transformer: Transformer, val output: File, val promise: Promise)

  override fun definition() = ModuleDefinition {
    Name("VideoTranscode")
    Events("onProgress")

    AsyncFunction("probe") { uri: String -> probe(uri) }

    // videoBitrate が null なら、符号化し直さず MP4 に入れ直す(moov を先頭に置く)。出力のパスを返す
    AsyncFunction("transcode") { uri: String, videoBitrate: Int?, promise: Promise ->
      mainHandler.post { start(uri, videoBitrate, promise) }
    }

    AsyncFunction("cancel") {
      mainHandler.post {
        stopRunning()?.promise?.reject(CodedException("ERR_TRANSCODE_CANCELLED", "変換を取りやめた", null))
      }
    }

    // JS の実行環境が無くなるので、promise には返さない
    OnDestroy {
      mainHandler.post { stopRunning() }
    }
  }

  // Transformer.cancel() の後は onCompleted も onError も来ない。出力の片付けと promise の完了はここで受け持つ
  private fun stopRunning(): Job? {
    val job = running ?: return null
    running = null
    job.transformer.cancel()
    job.output.delete()
    return job
  }

  private fun start(uri: String, videoBitrate: Int?, promise: Promise) {
    if (running != null) {
      promise.reject(CodedException("ERR_TRANSCODE_BUSY", "別の変換が動いている", null))
      return
    }
    val output = File(context.cacheDir, "transcoded-${UUID.randomUUID()}.mp4")
    val encoder = DefaultEncoderFactory.Builder(context)
    if (videoBitrate != null) {
      encoder.setRequestedVideoEncoderSettings(VideoEncoderSettings.Builder().setBitrate(videoBitrate).build())
    }
    val transformer = Transformer.Builder(context)
      .setVideoMimeType(MimeTypes.VIDEO_H264)
      .setAudioMimeType(MimeTypes.AUDIO_AAC)
      .setEncoderFactory(encoder.build())
      .addListener(object : Transformer.Listener {
        override fun onCompleted(composition: Composition, exportResult: ExportResult) {
          // 取りやめた後に届いても、promise は二度完了させない
          if (running?.output !== output) {
            return
          }
          running = null
          promise.resolve(output.absolutePath)
        }

        override fun onError(composition: Composition, exportResult: ExportResult, exportException: ExportException) {
          if (running?.output !== output) {
            return
          }
          running = null
          output.delete()
          promise.reject(CodedException("ERR_TRANSCODE", exportException.message ?: "変換に失敗した", exportException))
        }
      })
      .build()
    val job = Job(transformer, output, promise)
    running = job
    transformer.start(EditedMediaItem.Builder(MediaItem.fromUri(Uri.parse(uri))).build(), output.absolutePath)
    pollProgress(job)
  }

  private fun pollProgress(job: Job) {
    val transformer = job.transformer
    val holder = ProgressHolder()
    mainHandler.postDelayed(object : Runnable {
      override fun run() {
        if (running !== job) {
          return
        }
        if (transformer.getProgress(holder) == Transformer.PROGRESS_STATE_AVAILABLE) {
          sendEvent("onProgress", mapOf("progress" to holder.progress / 100.0))
        }
        mainHandler.postDelayed(this, PROGRESS_INTERVAL_MS)
      }
    }, PROGRESS_INTERVAL_MS)
  }

  // planVideo に渡す、元の動画の測った値
  private fun probe(uri: String): Map<String, Any?> {
    val result = mutableMapOf<String, Any?>()
    val parsed = Uri.parse(uri)
    val extractor = MediaExtractor()
    try {
      extractor.setDataSource(context, parsed, null)
      for (i in 0 until extractor.trackCount) {
        val format = extractor.getTrackFormat(i)
        val mime = format.getString(MediaFormat.KEY_MIME) ?: continue
        if (mime.startsWith("video/") && "videoCodec" !in result) {
          result["videoCodec"] = codecName(mime)
          if (format.containsKey(MediaFormat.KEY_FRAME_RATE)) {
            result["frameRate"] = frameRateOf(format)
          }
          if (format.containsKey(MediaFormat.KEY_BIT_RATE)) {
            result["videoBitrate"] = format.getInteger(MediaFormat.KEY_BIT_RATE)
          }
        } else if (mime.startsWith("audio/") && "audioCodec" !in result) {
          result["audioCodec"] = codecName(mime)
          if (format.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) {
            result["audioChannels"] = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
          }
        }
      }
    } finally {
      extractor.release()
    }
    val retriever = MediaMetadataRetriever()
    try {
      retriever.setDataSource(context, parsed)
      val number = { key: Int -> retriever.extractMetadata(key)?.toDoubleOrNull() }
      val width = number(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)
      val height = number(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)
      val rotation = number(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION) ?: 0.0
      val sideways = rotation == 90.0 || rotation == 270.0
      result["width"] = if (sideways) height else width
      result["height"] = if (sideways) width else height
      result["durationMs"] = number(MediaMetadataRetriever.METADATA_KEY_DURATION)
      // トラックに無ければ、全体のビットレートで代える
      if ("videoBitrate" !in result) {
        result["videoBitrate"] = number(MediaMetadataRetriever.METADATA_KEY_BITRATE)
      }
    } finally {
      retriever.release()
    }
    return result
  }

  // フレームレートは端末や形式によって Integer でも Float でも入っている。
  // MediaFormat.getNumber と getValueTypeForKey は API 29 からで、minSdk(24)では使えないので、読んで型を確かめる
  private fun frameRateOf(format: MediaFormat): Double = try {
    format.getInteger(MediaFormat.KEY_FRAME_RATE).toDouble()
  } catch (_: ClassCastException) {
    format.getFloat(MediaFormat.KEY_FRAME_RATE).toDouble()
  }

  private fun codecName(mime: String): String = when (mime) {
    MimeTypes.VIDEO_H264 -> "h264"
    MimeTypes.VIDEO_H265 -> "hevc"
    MimeTypes.AUDIO_AAC -> "aac"
    else -> mime.substringAfter('/')
  }
}
