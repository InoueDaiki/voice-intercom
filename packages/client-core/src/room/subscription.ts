// 購読するトラックの決め方(services/agent の README の「ルームとの取り決め」)。
//
// autoSubscribe は切ってあり、次のものだけを購読する。
// - 話者(Agent 以外の参加者)のマイクのトラック。元の音声
// - Agent の、自分の言語の翻訳音声のトラック(`translation-<言語>`)。音声の翻訳と、
//   テキスト入力の読み上げ(訳と、自分と同じ言語の原文)が混ざっている
//
// 購読できる音声トラックは1人100本まで(設計メモの「LiveKit の設計」)なので、
// ほかの言語の翻訳音声は購読しない。
export function shouldSubscribe(track: {
  isAudio: boolean;
  fromAgent: boolean;
  isMicrophone: boolean;
  trackName: string;
  myLanguage: string;
}): boolean {
  if (!track.isAudio) {
    return false;
  }
  if (track.fromAgent) {
    return track.trackName === translationTrackName(track.myLanguage);
  }
  return track.isMicrophone;
}

export function translationTrackName(language: string): string {
  return `translation-${language}`;
}
