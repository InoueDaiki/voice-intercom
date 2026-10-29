import ExpoModulesCore

// Core(PttChannelCore)を JS につなぐ薄い層。処理は持たず、呼び出しと出来事を受け渡すだけにする

public final class IntercomOsModule: Module, PttChannelListener {
  public func definition() -> ModuleDefinition {
    Name("IntercomOs")

    Events("onPttEvent")

    // JS が listener を付けたら、起動してから貯まっていた出来事も含めて渡し始める
    OnStartObserving("onPttEvent") {
      PttChannelCore.shared.setListener(self)
    }

    OnStopObserving("onPttEvent") {
      PttChannelCore.shared.setListener(nil)
    }

    AsyncFunction("join") { (channelId: String, name: String) in
      try await PttChannelCore.shared.join(channelId: channelId, name: name)
    }

    AsyncFunction("leave") {
      try await PttChannelCore.shared.leave()
    }

    AsyncFunction("beginTransmitting") {
      try await PttChannelCore.shared.beginTransmitting()
    }

    AsyncFunction("stopTransmitting") {
      try await PttChannelCore.shared.stopTransmitting()
    }

    AsyncFunction("setActiveRemoteParticipant") { (name: String?) in
      try await PttChannelCore.shared.setActiveRemoteParticipant(name: name)
    }

    AsyncFunction("setServiceStatus") { (status: String) in
      guard let value = PttServiceStatus(rawValue: status) else {
        throw Exception(name: "InvalidArgument", description: "setServiceStatus: \(status)")
      }
      try await PttChannelCore.shared.setServiceStatus(value)
    }

    AsyncFunction("setTransmissionMode") { (mode: String) in
      guard let value = PttTransmissionMode(rawValue: mode) else {
        throw Exception(name: "InvalidArgument", description: "setTransmissionMode: \(mode)")
      }
      try await PttChannelCore.shared.setTransmissionMode(value)
    }

    AsyncFunction("getActiveChannelId") { () async -> String? in
      await PttChannelCore.shared.activeChannelId
    }
  }

  public func pttChannel(didEmit event: PttEvent) {
    var body: [String: Any?] = event.fields
    body["type"] = event.type
    body["atMs"] = event.atMs
    sendEvent("onPttEvent", body)
  }
}
