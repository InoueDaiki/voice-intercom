import AVFAudio
import Foundation
import PushToTalk

// OS の Push to Talk の仕組み(PTChannelManager)を包む。React Native にも Expo にも依らない
// (つなぐ層は ios/Binding)。ネイティブのアプリに移るときは、このフォルダをそのまま持っていく。
//
// - アプリの起動(didFinishLaunching)で prepare を呼ぶ。閉じたアプリを push で起こしたときと、
//   チャンネルの復元のため、起動のたびにすぐ PTChannelManager を作る必要がある(Apple の決まり)。
// - 起きたことはすべて PttEvent にして listener に渡す。listener がいない間(JS が起動する前)は貯めておき、
//   listener が付いたときにまとめて渡す。
// - 音声セッションは自分で有効にしない(Apple の決まり)。システムが有効にしたら audioActivated を出すので、
//   受け手(WebRTC を持つ層)がそこで音を出し始める。

public struct PttEvent {
  public let type: String
  // 起きた時刻(UNIX 時間のミリ秒)。push から声が出るまでの時間を測るのに使う
  public let atMs: Double
  public let fields: [String: Any]
}

public protocol PttChannelListener: AnyObject {
  func pttChannel(didEmit event: PttEvent)
}

public enum PttChannelError: LocalizedError {
  case invalidChannelId(String)
  case noActiveChannel

  public var errorDescription: String? {
    switch self {
    case .invalidChannelId(let id): "チャンネルの ID が UUID ではない: \(id)"
    case .noActiveChannel: "参加しているチャンネルがない"
    }
  }
}

public enum PttServiceStatus: String {
  case ready, connecting, unavailable
}

public enum PttTransmissionMode: String {
  case fullDuplex, halfDuplex, listenOnly
}

public final class PttChannelCore: NSObject, @unchecked Sendable {
  public static let shared = PttChannelCore()

  // チャンネルの名前(復元のときにシステムへ返す)。UUID の文字列ごとに持つ
  private static let channelNamesKey = "IntercomOs.channelNames"

  private let lock = NSLock()
  private var pending: [PttEvent] = []
  private weak var listener: PttChannelListener?
  private var audioCategoryConfigured = false
  private var managerTask: Task<PTChannelManager, Error>?

  // 起動のたびに一度呼ぶ。2回目からは何もしない
  public func prepare() {
    // カテゴリの設定は失敗すると emit する。emit は同じ lock を取るので、lock を持ったまま呼ばない
    let configureAudio = lock.withLock {
      defer { audioCategoryConfigured = true }
      return !audioCategoryConfigured
    }
    if configureAudio {
      configureAudioCategory()
    }
    // manager() がすぐ task を読むので、prepare から戻る前に必ず作る
    lock.withLock {
      if managerTask != nil {
        return
      }
      managerTask = Task {
        do {
          let manager = try await PTChannelManager.channelManager(delegate: self, restorationDelegate: self)
          emit("ready", ["activeChannelId": manager.activeChannelUUID?.uuidString as Any])
          return manager
        } catch {
          emit("error", ["operation": "prepare", "message": error.localizedDescription])
          throw error
        }
      }
    }
  }

  // listener を付ける・外す。付けたときに、貯めていた出来事をまとめて渡す
  public func setListener(_ newListener: PttChannelListener?) {
    lock.lock()
    listener = newListener
    let flushed = newListener == nil ? [] : pending
    if newListener != nil {
      pending.removeAll()
    }
    lock.unlock()
    for event in flushed {
      newListener?.pttChannel(didEmit: event)
    }
  }

  public var activeChannelId: String? {
    get async { try? await manager().activeChannelUUID?.uuidString }
  }

  // 前面にいるときにだけ参加できる(Apple の決まり)
  public func join(channelId: String, name: String) async throws {
    let uuid = try parse(channelId)
    saveChannelName(name, for: uuid)
    try await manager().requestJoinChannel(channelUUID: uuid, descriptor: PTChannelDescriptor(name: name, image: nil))
  }

  public func leave() async throws {
    let m = try await manager()
    guard let uuid = m.activeChannelUUID else { throw PttChannelError.noActiveChannel }
    m.leaveChannel(channelUUID: uuid)
  }

  public func beginTransmitting() async throws {
    let m = try await manager()
    guard let uuid = m.activeChannelUUID else { throw PttChannelError.noActiveChannel }
    m.requestBeginTransmitting(channelUUID: uuid)
  }

  public func stopTransmitting() async throws {
    let m = try await manager()
    guard let uuid = m.activeChannelUUID else { throw PttChannelError.noActiveChannel }
    m.stopTransmitting(channelUUID: uuid)
  }

  // 相手が話し始めたら名前を、話し終えたら nil を渡す。渡すとシステムが音声セッションを有効・無効にする
  public func setActiveRemoteParticipant(name: String?) async throws {
    let m = try await manager()
    guard let uuid = m.activeChannelUUID else { throw PttChannelError.noActiveChannel }
    try await m.setActiveRemoteParticipant(name.map { PTParticipant(name: $0, image: nil) }, channelUUID: uuid)
  }

  // つながっているかをシステムの画面に出す
  public func setServiceStatus(_ status: PttServiceStatus) async throws {
    let m = try await manager()
    guard let uuid = m.activeChannelUUID else { throw PttChannelError.noActiveChannel }
    let value: PTServiceStatus =
      switch status {
      case .ready: .ready
      case .connecting: .connecting
      case .unavailable: .unavailable
      }
    try await m.setServiceStatus(value, channelUUID: uuid)
  }

  // 既定は halfDuplex(相手が話している間は話せない)。fullDuplex なら同時に話せる
  public func setTransmissionMode(_ mode: PttTransmissionMode) async throws {
    let m = try await manager()
    guard let uuid = m.activeChannelUUID else { throw PttChannelError.noActiveChannel }
    let value: PTTransmissionMode =
      switch mode {
      case .fullDuplex: .fullDuplex
      case .halfDuplex: .halfDuplex
      case .listenOnly: .listenOnly
      }
    try await m.setTransmissionMode(value, channelUUID: uuid)
  }

  private func manager() async throws -> PTChannelManager {
    prepare()
    let task = lock.withLock { managerTask }
    // prepare の後なので task はある
    return try await task!.value
  }

  private func parse(_ channelId: String) throws -> UUID {
    guard let uuid = UUID(uuidString: channelId) else { throw PttChannelError.invalidChannelId(channelId) }
    return uuid
  }

  // Push to Talk の仕組みは、起動の時点でカテゴリを playAndRecord にしておくことを求める(有効にはしない)
  private func configureAudioCategory() {
    // allowBluetoothHFP は Xcode 26 の SDK から(言語のモードではなく、コンパイラーの版で分ける)
    #if compiler(>=6.2)
      let options: AVAudioSession.CategoryOptions = [.defaultToSpeaker, .allowBluetoothHFP]
    #else
      let options: AVAudioSession.CategoryOptions = [.defaultToSpeaker, .allowBluetooth]
    #endif
    do {
      try AVAudioSession.sharedInstance().setCategory(.playAndRecord, mode: .voiceChat, options: options)
    } catch {
      emit("error", ["operation": "setCategory", "message": error.localizedDescription])
    }
  }

  private func saveChannelName(_ name: String, for uuid: UUID) {
    var names = UserDefaults.standard.dictionary(forKey: Self.channelNamesKey) as? [String: String] ?? [:]
    names[uuid.uuidString] = name
    UserDefaults.standard.set(names, forKey: Self.channelNamesKey)
  }

  private func channelName(for uuid: UUID) -> String {
    let names = UserDefaults.standard.dictionary(forKey: Self.channelNamesKey) as? [String: String]
    return names?[uuid.uuidString] ?? "ルーム"
  }

  private func emit(_ type: String, _ fields: [String: Any] = [:]) {
    let event = PttEvent(type: type, atMs: Date().timeIntervalSince1970 * 1000, fields: fields)
    lock.lock()
    let current = listener
    if current == nil {
      pending.append(event)
    }
    lock.unlock()
    current?.pttChannel(didEmit: event)
  }
}

extension PttChannelCore: PTChannelManagerDelegate {
  public func channelManager(_ channelManager: PTChannelManager, didJoinChannel channelUUID: UUID, reason: PTChannelJoinReason) {
    emit("joined", ["channelId": channelUUID.uuidString, "reason": describe(reason)])
  }

  public func channelManager(_ channelManager: PTChannelManager, didLeaveChannel channelUUID: UUID, reason: PTChannelLeaveReason) {
    emit("left", ["channelId": channelUUID.uuidString, "reason": describe(reason)])
  }

  public func channelManager(_ channelManager: PTChannelManager, failedToJoinChannel channelUUID: UUID, error: any Error) {
    emit("error", ["operation": "join", "channelId": channelUUID.uuidString, "message": error.localizedDescription])
  }

  public func channelManager(_ channelManager: PTChannelManager, failedToLeaveChannel channelUUID: UUID, error: any Error) {
    emit("error", ["operation": "leave", "channelId": channelUUID.uuidString, "message": error.localizedDescription])
  }

  public func channelManager(
    _ channelManager: PTChannelManager, channelUUID: UUID, didBeginTransmittingFrom source: PTChannelTransmitRequestSource
  ) {
    emit("transmissionBegan", ["channelId": channelUUID.uuidString, "source": describe(source)])
  }

  public func channelManager(
    _ channelManager: PTChannelManager, channelUUID: UUID, didEndTransmittingFrom source: PTChannelTransmitRequestSource
  ) {
    emit("transmissionEnded", ["channelId": channelUUID.uuidString, "source": describe(source)])
  }

  public func channelManager(
    _ channelManager: PTChannelManager, failedToBeginTransmittingInChannel channelUUID: UUID, error: any Error
  ) {
    emit("error", ["operation": "beginTransmitting", "channelId": channelUUID.uuidString, "message": error.localizedDescription])
  }

  public func channelManager(_ channelManager: PTChannelManager, failedToStopTransmittingInChannel channelUUID: UUID, error: any Error) {
    emit("error", ["operation": "stopTransmitting", "channelId": channelUUID.uuidString, "message": error.localizedDescription])
  }

  // サーバーが APNs(apns-push-type: pushtotalk)で送るときの宛先。FCM のトークンとは別物
  public func channelManager(_ channelManager: PTChannelManager, receivedEphemeralPushToken pushToken: Data) {
    emit("pushToken", ["token": pushToken.map { String(format: "%02x", $0) }.joined()])
  }

  // 閉じたアプリでも呼ばれる。すぐ返す(重い処理やネットワークはしない)。
  // payload の speaker を話している人として返すと、システムが音声セッションを有効にする。leave が true ならチャンネルを出る
  public func incomingPushResult(channelManager: PTChannelManager, channelUUID: UUID, pushPayload: [String: Any]) -> PTPushResult {
    let payload = JSONSerialization.isValidJSONObject(pushPayload) ? pushPayload : [:]
    emit("incomingPush", ["channelId": channelUUID.uuidString, "payload": payload])
    if pushPayload["leave"] as? Bool == true {
      return .leaveChannel
    }
    let speaker = pushPayload["speaker"] as? String ?? "だれか"
    return .activeRemoteParticipant(PTParticipant(name: speaker, image: nil))
  }

  public func channelManager(_ channelManager: PTChannelManager, didActivate audioSession: AVAudioSession) {
    emit("audioActivated")
  }

  public func channelManager(_ channelManager: PTChannelManager, didDeactivate audioSession: AVAudioSession) {
    emit("audioDeactivated")
  }
}

extension PttChannelCore: PTChannelRestorationDelegate {
  // 再起動のあとにシステムがチャンネルを戻すとき、同期で名前を返す
  public func channelDescriptor(restoredChannelUUID channelUUID: UUID) -> PTChannelDescriptor {
    PTChannelDescriptor(name: channelName(for: channelUUID), image: nil)
  }
}

private func describe(_ reason: PTChannelJoinReason) -> String {
  switch reason {
  case .developerRequest: "developerRequest"
  case .channelRestoration: "channelRestoration"
  @unknown default: "unknown"
  }
}

private func describe(_ reason: PTChannelLeaveReason) -> String {
  switch reason {
  case .userRequest: "userRequest"
  case .developerRequest: "developerRequest"
  case .systemPolicy: "systemPolicy"
  case .unknown: "unknown"
  @unknown default: "unknown"
  }
}

private func describe(_ source: PTChannelTransmitRequestSource) -> String {
  switch source {
  case .userRequest: "userRequest"
  case .developerRequest: "developerRequest"
  case .handsfreeButton: "handsfreeButton"
  case .unknown: "unknown"
  @unknown default: "unknown"
  }
}
