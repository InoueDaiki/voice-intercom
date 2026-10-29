// Expo の設定プラグイン。prebuild で、Push to Talk の仕組みに要る設定を iOS のプロジェクトに書く。
//
// - UIBackgroundModes に push-to-talk を足す
// - entitlement に com.apple.developer.push-to-talk と aps-environment を足す
// - マイクの使い方の説明
//
// オプション:
// - audioBackgroundMode: UIBackgroundModes に audio も足すか(既定は false)。
//   「入室中は裏でも音声を保つ」方式と同じアプリで併せたときの振る舞いを確かめるため
// - apsEnvironment: "development"(既定)か "production"
// - microphoneUsage: マイクの使い方の説明

const { withEntitlementsPlist, withInfoPlist } = require("expo/config-plugins");

function addBackgroundModes(infoPlist, modes) {
  const current = new Set(infoPlist.UIBackgroundModes ?? []);
  for (const mode of modes) {
    current.add(mode);
  }
  infoPlist.UIBackgroundModes = [...current];
}

module.exports = function withIntercomOs(config, options = {}) {
  const { audioBackgroundMode = false, apsEnvironment = "development", microphoneUsage } = options;

  config = withInfoPlist(config, (c) => {
    addBackgroundModes(c.modResults, audioBackgroundMode ? ["push-to-talk", "audio"] : ["push-to-talk"]);
    c.modResults.NSMicrophoneUsageDescription =
      microphoneUsage ?? c.modResults.NSMicrophoneUsageDescription ?? "話すときにマイクを使います";
    return c;
  });

  config = withEntitlementsPlist(config, (c) => {
    c.modResults["com.apple.developer.push-to-talk"] = true;
    c.modResults["aps-environment"] = apsEnvironment;
    return c;
  });

  return config;
};
