/// 購読するトラックの決め方(services/agent の README の「ルームとの取り決め」)。
///
/// autoSubscribe は切ってあり、次のものだけを購読する。
/// - 話者(Agent 以外の参加者)のマイクのトラック。元の音声
/// - Agent の、自分の言語の翻訳音声のトラック(`translation-<言語>`)。音声の翻訳と、
///   テキスト入力の読み上げ(訳と、自分と同じ言語の原文)が混ざっている
///
/// 購読できる音声トラックは1人100本まで(設計メモの「LiveKit の設計」)なので、
/// ほかの言語の翻訳音声は購読しない。
bool shouldSubscribe({
  required bool isAudio,
  required bool fromAgent,
  required bool isMicrophone,
  required String trackName,
  required String myLanguage,
}) {
  if (!isAudio) {
    return false;
  }
  if (fromAgent) {
    return trackName == translationTrackName(myLanguage);
  }
  return isMicrophone;
}

String translationTrackName(String language) => 'translation-$language';
