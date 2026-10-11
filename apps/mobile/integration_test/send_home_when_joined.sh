#!/usr/bin/env bash
# 統合テスト(background_test.dart)のホスト側の役。Android エミュレーターで、テストの合図
# (flutter test の出力の「BG_TEST:」。統合テストの print は logcat ではなくホストに届く)を
# 待って、ホームに戻す・前面に戻す。裏にいる間と退室の後に、フォアグラウンドサービス、
# プロセスの状態、音声の再生と録音を表示する。flutter test の出力をパイプで渡す:
#
#   flutter test integration_test/background_test.dart ... 2>&1 | integration_test/send_home_when_joined.sh
set -euo pipefail
adb=${ADB:-adb}
pkg=jp.voiceintercom.voice_intercom
# flutter test はアプリを入れ直すので、入ったらすぐ権限を与える(ダイアログで止まらないように)
(
  until $adb shell pm list packages | grep -q "$pkg"; do sleep 0.2; done
  $adb shell pm grant $pkg android.permission.RECORD_AUDIO
  $adb shell pm grant $pkg android.permission.POST_NOTIFICATIONS
  echo "権限を与えた"
) &

show() {
  echo "--- $1"
  $adb shell dumpsys activity services $pkg | grep -E "ServiceRecord|isForeground|foregroundServiceType" || echo "(サービスなし)"
  $adb shell dumpsys activity processes | grep -E "^ *\*.*$pkg|procState|curProcState" | grep -A2 "$pkg" | head -4 || true
  local uid
  uid=$($adb shell dumpsys package $pkg | sed -n 's/^ *uid=\([0-9]*\).*/\1/p' | head -1)
  echo "再生(state:started が鳴っているもの):"
  $adb shell dumpsys audio | grep -E "AudioPlaybackConfiguration.*u/pid:$uid/" |
    grep -oE "state:[a-z]+|usage=[A-Z_]+|mutedState:[a-z_]+" | paste -sd' ' - || true
  echo "録音(最後の記録。silenced なら OS がマイクを止めている):"
  $adb shell dumpsys audio | grep -E "rec .* uid:$uid " | tail -1 || true
}

# テストの出力はそのまま流す。途中で抜けるとパイプが切れて flutter test が止まるので、最後まで読む
while IFS= read -r line; do
  echo "$line"
  case "$line" in
    *"BG_TEST: joined"*)
      $adb shell input keyevent KEYCODE_HOME
      echo "ホームに戻した"
      sleep 5
      show "裏にいる間"
      ;;
    *"BG_TEST: received in background"*)
      show "裏で字幕を受け取った後"
      $adb shell am start -n $pkg/.MainActivity > /dev/null
      echo "前面に戻した"
      ;;
    *"BG_TEST: left"*)
      sleep 2
      show "退室の後"
      ;;
  esac
done
