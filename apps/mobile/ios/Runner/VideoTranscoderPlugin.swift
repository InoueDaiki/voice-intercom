import AVFoundation
import Flutter
import UIKit

/// 動画を測り、H.264 の MP4 にし、フレームを取り出す(lib/media/video_transcoder.dart)。
///
/// - 符号化し直すとき: AVAssetReader で読み、AVAssetWriter で書く。解像度・フレームレート・回転
///   (preferredTransform)は元のまま、映像のビットレートは Dart から渡された値。
///   `shouldOptimizeForNetworkUse` で moov を先頭に置く。HDR(HLG・Dolby Vision)は BT.709 の SDR にする。
///   音声は AAC(2チャンネルまで、1チャンネルあたり 96kbps)。
/// - 入れ直すだけのとき(videoBitrate が null): AVAssetExportSession のパススルー。
final class VideoTranscoderPlugin: NSObject, FlutterPlugin {
  private let channel: FlutterMethodChannel

  init(channel: FlutterMethodChannel) {
    self.channel = channel
  }

  static func register(with registrar: FlutterPluginRegistrar) {
    let channel = FlutterMethodChannel(
      name: "voiceintercom/video", binaryMessenger: registrar.messenger())
    let instance = VideoTranscoderPlugin(channel: channel)
    registrar.addMethodCallDelegate(instance, channel: channel)
  }

  func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
    let args = call.arguments as? [String: Any] ?? [:]
    guard let path = args["path"] as? String else {
      result(FlutterError(code: "bad_args", message: "path が無い", details: nil))
      return
    }
    let url = URL(fileURLWithPath: path)
    switch call.method {
    case "probe":
      Task {
        do {
          let info = try await VideoProbe.probe(url)
          await MainActor.run { result(info) }
        } catch {
          await MainActor.run {
            result(FlutterError(code: "probe_failed", message: "\(error)", details: nil))
          }
        }
      }
    case "transcode":
      guard let outPath = args["outPath"] as? String else {
        result(FlutterError(code: "bad_args", message: "outPath が無い", details: nil))
        return
      }
      let bitrate = (args["videoBitrate"] as? NSNumber)?.intValue
      let outURL = URL(fileURLWithPath: outPath)
      let channel = self.channel
      var lastSent = -1.0
      let progress: (Double) -> Void = { value in
        // 1% ごとに送る
        guard value - lastSent >= 0.01 || value >= 1 else { return }
        lastSent = value
        DispatchQueue.main.async { channel.invokeMethod("progress", arguments: value) }
      }
      Task {
        do {
          try? FileManager.default.removeItem(at: outURL)
          if let bitrate {
            try await VideoReencoder(source: url, destination: outURL, videoBitrate: bitrate)
              .run(progress: progress)
          } else {
            try await VideoReencoder.remux(source: url, destination: outURL, progress: progress)
          }
          await MainActor.run { result(nil) }
        } catch {
          try? FileManager.default.removeItem(at: outURL)
          await MainActor.run {
            result(FlutterError(code: "transcode_failed", message: "\(error)", details: nil))
          }
        }
      }
    case "frame":
      let maxSide = (args["maxSide"] as? NSNumber)?.intValue ?? 960
      let generator = AVAssetImageGenerator(asset: AVURLAsset(url: url))
      generator.appliesPreferredTrackTransform = true
      generator.maximumSize = CGSize(width: maxSide, height: maxSide)
      generator.generateCGImagesAsynchronously(forTimes: [NSValue(time: .zero)]) {
        _, image, _, _, _ in
        let data = image.flatMap { UIImage(cgImage: $0).jpegData(compressionQuality: 0.8) }
        DispatchQueue.main.async {
          result(data.map { FlutterStandardTypedData(bytes: $0) })
        }
      }
    default:
      result(FlutterMethodNotImplemented)
    }
  }
}

enum VideoTranscodeError: Error {
  case noVideoTrack
  case cannotStart(String)
  case failed(String)
}

enum VideoProbe {
  /// 幅・高さは符号化された画素(回転の前)、rotation は表示のときの時計回りの回転
  static func probe(_ url: URL) async throws -> [String: Any?] {
    let asset = AVURLAsset(url: url)
    let duration = try await asset.load(.duration)
    guard let video = try await asset.loadTracks(withMediaType: .video).first else {
      throw VideoTranscodeError.noVideoTrack
    }
    let (size, transform, fps, rate, formats) = try await video.load(
      .naturalSize, .preferredTransform, .nominalFrameRate, .estimatedDataRate,
      .formatDescriptions)
    var info: [String: Any?] = [
      "width": Int(size.width.rounded()),
      "height": Int(size.height.rounded()),
      "rotation": rotationDegrees(transform),
      "durationMs": duration.isNumeric ? duration.seconds * 1000 : nil,
      "frameRate": fps > 0 ? Double(fps) : nil,
      "videoBitrate": rate > 0 ? Int(rate) : nil,
      "videoCodec": formats.first.map { codecName(CMFormatDescriptionGetMediaSubType($0)) },
      "audioCodec": nil,
    ]
    if let audio = try await asset.loadTracks(withMediaType: .audio).first,
      let format = try await audio.load(.formatDescriptions).first
    {
      info["audioCodec"] = codecName(CMFormatDescriptionGetMediaSubType(format))
      if let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(format)?.pointee {
        info["audioChannels"] = Int(asbd.mChannelsPerFrame)
      }
    }
    return info
  }

  static func rotationDegrees(_ t: CGAffineTransform) -> Int {
    let degrees = Int((atan2(t.b, t.a) * 180 / .pi).rounded())
    return ((degrees % 360) + 360) % 360
  }

  static func codecName(_ type: FourCharCode) -> String {
    switch type {
    case kCMVideoCodecType_H264: return "h264"
    case kCMVideoCodecType_HEVC, kCMVideoCodecType_HEVCWithAlpha: return "hevc"
    case kAudioFormatMPEG4AAC: return "aac"
    default:
      let bytes = [24, 16, 8, 0].map { UInt8((type >> $0) & 0xff) }
      return String(bytes: bytes, encoding: .ascii)?.trimmingCharacters(in: .whitespaces)
        .lowercased() ?? "unknown"
    }
  }
}

/// AVAssetReader → AVAssetWriter で H.264 の MP4 にする
final class VideoReencoder {
  let source: URL
  let destination: URL
  let videoBitrate: Int

  init(source: URL, destination: URL, videoBitrate: Int) {
    self.source = source
    self.destination = destination
    self.videoBitrate = videoBitrate
  }

  /// 符号化し直さず MP4 に入れ直す(moov を先頭に置く)
  static func remux(source: URL, destination: URL, progress: @escaping (Double) -> Void)
    async throws
  {
    let asset = AVURLAsset(url: source)
    guard
      let session = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetPassthrough)
    else {
      throw VideoTranscodeError.cannotStart("AVAssetExportSession")
    }
    session.outputURL = destination
    session.outputFileType = .mp4
    session.shouldOptimizeForNetworkUse = true
    let timer = DispatchSource.makeTimerSource(queue: .global())
    timer.schedule(deadline: .now(), repeating: .milliseconds(200))
    timer.setEventHandler { progress(Double(session.progress)) }
    timer.resume()
    await session.export()
    timer.cancel()
    guard session.status == .completed else {
      throw VideoTranscodeError.failed(session.error.map { "\($0)" } ?? "\(session.status)")
    }
    progress(1)
  }

  func run(progress: @escaping (Double) -> Void) async throws {
    let asset = AVURLAsset(url: source)
    let duration = try await asset.load(.duration)
    guard let videoTrack = try await asset.loadTracks(withMediaType: .video).first else {
      throw VideoTranscodeError.noVideoTrack
    }
    let (size, transform, fps) = try await videoTrack.load(
      .naturalSize, .preferredTransform, .nominalFrameRate)
    let audioTrack = try await asset.loadTracks(withMediaType: .audio).first
    var audioFormat: AudioStreamBasicDescription?
    if let audioTrack, let format = try await audioTrack.load(.formatDescriptions).first {
      audioFormat = CMAudioFormatDescriptionGetStreamBasicDescription(format)?.pointee
    }

    let reader = try AVAssetReader(asset: asset)
    let writer = try AVAssetWriter(outputURL: destination, fileType: .mp4)
    writer.shouldOptimizeForNetworkUse = true

    // 映像。SDR の BT.709 で読む(HDR はここで SDR になる)
    let sdr: [String: Any] = [
      AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2,
      AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2,
      AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2,
    ]
    let videoOutput = AVAssetReaderTrackOutput(
      track: videoTrack,
      outputSettings: [
        kCVPixelBufferPixelFormatTypeKey as String:
          kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange,
        AVVideoColorPropertiesKey: sdr,
      ])
    videoOutput.alwaysCopiesSampleData = false
    // H.264 は幅・高さが偶数でないと符号化できない
    let width = Int(size.width.rounded()) & ~1
    let height = Int(size.height.rounded()) & ~1
    var compression: [String: Any] = [
      AVVideoAverageBitRateKey: videoBitrate,
      AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
      AVVideoH264EntropyModeKey: AVVideoH264EntropyModeCABAC,
      AVVideoMaxKeyFrameIntervalDurationKey: 2,
    ]
    if fps > 0 {
      compression[AVVideoExpectedSourceFrameRateKey] = Int(fps.rounded())
    }
    let videoInput = AVAssetWriterInput(
      mediaType: .video,
      outputSettings: [
        AVVideoCodecKey: AVVideoCodecType.h264,
        AVVideoWidthKey: width,
        AVVideoHeightKey: height,
        AVVideoColorPropertiesKey: sdr,
        AVVideoCompressionPropertiesKey: compression,
      ])
    videoInput.expectsMediaDataInRealTime = false
    videoInput.transform = transform
    guard reader.canAdd(videoOutput), writer.canAdd(videoInput) else {
      throw VideoTranscodeError.cannotStart("video")
    }
    reader.add(videoOutput)
    writer.add(videoInput)

    // 音声。AAC にする(2チャンネルまで、48kHz まで)
    var audioPair: (AVAssetReaderTrackOutput, AVAssetWriterInput)?
    if let audioTrack {
      let channels = min(max(Int(audioFormat?.mChannelsPerFrame ?? 2), 1), 2)
      let sourceRate = audioFormat?.mSampleRate ?? 0
      let sampleRate = sourceRate > 0 ? min(sourceRate, 48000) : 44100
      var layout = AudioChannelLayout()
      layout.mChannelLayoutTag =
        channels == 1 ? kAudioChannelLayoutTag_Mono : kAudioChannelLayoutTag_Stereo
      let layoutData = Data(bytes: &layout, count: MemoryLayout<AudioChannelLayout>.size)
      let output = AVAssetReaderTrackOutput(
        track: audioTrack,
        outputSettings: [
          AVFormatIDKey: kAudioFormatLinearPCM,
          AVLinearPCMBitDepthKey: 16,
          AVLinearPCMIsFloatKey: false,
          AVLinearPCMIsBigEndianKey: false,
          AVLinearPCMIsNonInterleaved: false,
          AVSampleRateKey: sampleRate,
          AVNumberOfChannelsKey: channels,
          AVChannelLayoutKey: layoutData,
        ])
      output.alwaysCopiesSampleData = false
      let input = AVAssetWriterInput(
        mediaType: .audio,
        outputSettings: [
          AVFormatIDKey: kAudioFormatMPEG4AAC,
          AVSampleRateKey: sampleRate,
          AVNumberOfChannelsKey: channels,
          AVChannelLayoutKey: layoutData,
          AVEncoderBitRateKey: 96_000 * channels,
        ])
      input.expectsMediaDataInRealTime = false
      if reader.canAdd(output), writer.canAdd(input) {
        reader.add(output)
        writer.add(input)
        audioPair = (output, input)
      }
    }

    guard reader.startReading() else {
      throw VideoTranscodeError.cannotStart(reader.error.map { "\($0)" } ?? "reader")
    }
    guard writer.startWriting() else {
      reader.cancelReading()
      throw VideoTranscodeError.cannotStart(writer.error.map { "\($0)" } ?? "writer")
    }
    writer.startSession(atSourceTime: .zero)

    let total = duration.isNumeric && duration.seconds > 0 ? duration.seconds : 0
    await withTaskGroup(of: Void.self) { group in
      group.addTask {
        await Self.pump(
          output: videoOutput, input: videoInput, label: "video",
          onSample: { time in
            if total > 0 { progress(min(max(time.seconds / total, 0), 0.99)) }
          })
      }
      if let (output, input) = audioPair {
        group.addTask {
          await Self.pump(output: output, input: input, label: "audio", onSample: { _ in })
        }
      }
    }

    if reader.status == .failed || writer.status == .failed {
      reader.cancelReading()
      writer.cancelWriting()
      let error = writer.error ?? reader.error
      throw VideoTranscodeError.failed(error.map { "\($0)" } ?? "unknown")
    }
    await writer.finishWriting()
    guard writer.status == .completed else {
      throw VideoTranscodeError.failed(writer.error.map { "\($0)" } ?? "\(writer.status)")
    }
    progress(1)
  }

  /// 読み終わるか書けなくなるまで、サンプルを書き手に渡す
  private static func pump(
    output: AVAssetReaderOutput, input: AVAssetWriterInput, label: String,
    onSample: @escaping (CMTime) -> Void
  ) async {
    let queue = DispatchQueue(label: "voiceintercom.video.\(label)")
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      var finished = false
      input.requestMediaDataWhenReady(on: queue) {
        guard !finished else { return }
        while input.isReadyForMoreMediaData {
          guard let sample = output.copyNextSampleBuffer() else {
            input.markAsFinished()
            finished = true
            continuation.resume()
            return
          }
          onSample(CMSampleBufferGetPresentationTimeStamp(sample))
          if !input.append(sample) {
            // 書き手が失敗した。読み手は run の後で止める
            input.markAsFinished()
            finished = true
            continuation.resume()
            return
          }
        }
      }
    }
  }
}
