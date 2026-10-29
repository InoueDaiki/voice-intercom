import ExpoModulesCore

// 起動(didFinishLaunching)のたびに、JS の起動を待たずに PTChannelManager を作る。
// 閉じたアプリを push で起こしたとき、Apple はすぐに作ることを求める(作らないと push を受けられない)
public final class IntercomOsAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    PttChannelCore.shared.prepare()
    return true
  }
}
