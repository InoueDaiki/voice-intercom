import Flutter
import UIKit
import WebRTC

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    // 動画の測定と H.264 への符号化(lib/media/video_transcoder.dart)
    if let registrar = engineBridge.pluginRegistry.registrar(forPlugin: "VideoTranscoderPlugin") {
      VideoTranscoderPlugin.register(with: registrar)
    }
    // シミュレーターの音声(lib/room/room_session.dart の _initWebrtc)
    if let registrar = engineBridge.pluginRegistry.registrar(forPlugin: "SimulatorAudioPlugin") {
      SimulatorAudioPlugin.register(with: registrar)
    }
  }
}

/// iOS シミュレーターでは、WebRTC に音声のデバイスを開かせない。
///
/// flutter_webrtc はシミュレーターでだけ従来の ADM(AudioUnit。`AURemoteIO`)を使い、
/// その初期化がシミュレーターの音声の中継で `RPC timeout` になって落ちる(README の「iOS シミュレーター」)。
/// `useManualAudio` にして `isAudioEnabled` を切ると、ADM は音声ユニットを初期化しない。
/// マイクと再生は無音になるが、トラックの publish・購読とデータチャネルはそのまま動く。
/// 実機では何もしない。WebRTC を初期化する前に呼ぶ。
final class SimulatorAudioPlugin: NSObject, FlutterPlugin {
  static func register(with registrar: FlutterPluginRegistrar) {
    let channel = FlutterMethodChannel(
      name: "voice_intercom/simulator_audio", binaryMessenger: registrar.messenger())
    registrar.addMethodCallDelegate(SimulatorAudioPlugin(), channel: channel)
  }

  func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
    guard call.method == "detachFromDevice" else {
      result(FlutterMethodNotImplemented)
      return
    }
    #if targetEnvironment(simulator)
      let session = RTCAudioSession.sharedInstance()
      session.useManualAudio = true
      session.isAudioEnabled = false
      result(true)
    #else
      result(false)
    #endif
  }
}
