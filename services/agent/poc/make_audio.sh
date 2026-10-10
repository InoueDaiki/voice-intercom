#!/bin/sh
# README の「評価用の文」を読み上げ音声で WAV にする(macOS の say を使う)。
# 出力先は services/agent/poc/audio/(git 管理外)。
set -eu

out="$(cd "$(dirname "$0")" && pwd)/audio"
mkdir -p "$out"

gen() {
  # $1: 音声名、$2: ファイル名(拡張子なし)、$3: 読み上げる文
  say -v "$1" -o "$out/$2.wav" --data-format=LEI16@24000 "$3"
  echo "$out/$2.wav"
}

gen Kyoko ja-01 "明日の午後3時に、品川の第2会議室で打ち合わせをします。"
gen Kyoko ja-02 "在庫は残り1,250個です。発注番号はA-7034です。"
gen Kyoko ja-03 "田中さん、3番ゲートのフォークリフトを北側の倉庫に回してください。"
gen Kyoko ja-04 "はい。"
gen Kyoko ja-05 "すみません、もう一度お願いします。"

gen Samantha en-01 "The shipment of 250 units will arrive at Gate 14 on Thursday morning."
gen Samantha en-02 "Please send the invoice to Ms. Nakamura at Shibuya headquarters."
gen Samantha en-03 "Copy that."
gen Samantha en-04 "We need two more people on line B before 10:30."

# 長い発話の字幕の区切りを確かめる、30秒ほどの音声(services/agent/README.md の「字幕の区切りを確かめる」)。
# [[slnc ミリ秒]] は say の無音。文末の短い間(400ms)、文の途中の息継ぎ(500ms)、長い間(1200ms)を混ぜる
gen Kyoko long-ja-01 "お疲れさまです。北側の倉庫の田中です。[[slnc 400]] 今朝の入荷の件で連絡します。[[slnc 500]] 予定では、9時に届くはずだった、[[slnc 500]] 250個の部品が、まだ届いていません。[[slnc 1200]] 運送会社に確認したところ、渋滞で、30分ほど遅れるそうです。[[slnc 400]] そのため、3番ゲートのフォークリフトを、10時まで空けておいてください。[[slnc 400]] それから、発注番号A-7034の検品は、午後に回します。[[slnc 600]] 以上です。よろしくお願いします。"
gen Samantha long-en-01 "Hi, this is Mike from the north warehouse. [[slnc 400]] I'm calling about this morning's delivery. [[slnc 500]] The 250 parts that were supposed to arrive at 9, [[slnc 500]] still haven't come in. [[slnc 1200]] I checked with the carrier, and they're running about 30 minutes late because of traffic. [[slnc 400]] So please keep the forklift at Gate 3 free until 10. [[slnc 400]] Also, we'll move the inspection for order A-7034 to the afternoon. [[slnc 600]] That's all. Thanks."
