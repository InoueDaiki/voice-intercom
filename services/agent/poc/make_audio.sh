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
