import Flutter
import UIKit

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
  }
}
