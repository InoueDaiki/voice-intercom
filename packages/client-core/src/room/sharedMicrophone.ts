import { createLocalAudioTrack, LocalAudioTrack } from "livekit-client";

// clone した MediaStreamTrack を、publish できるトラックにする(テストで差し替える)
type WrapTrack = (track: LocalAudioTrack["mediaStreamTrack"]) => LocalAudioTrack;

// 複数のルームで、1本のマイクを分けて使う(設計メモの「ユーザーの3つの状態の表し方」)。
//
// ルームごとに getUserMedia を呼ぶと、iOS の Safari では前に取ったマイクのトラックがミュートされる
// (推測。確かめていない)。そこで、マイクは1回だけ取り、ルームごとには clone() したトラックを渡す。
// ミュート(enabled)はトラックごとなので、ルームごとの PTT ができる。
//
// clone したトラックは、livekit-client から見ると利用者が渡したトラック(userProvidedTrack)なので、
// 止まった(ended)ときに SDK が取り直さない。代わりに、次に acquire するときに元のマイクが止まって
// いれば取り直す(音声を切ってつなぎ直せば戻る)。
export class SharedMicrophone {
  private readonly create: () => Promise<LocalAudioTrack>;
  private readonly wrap: WrapTrack;
  private source: Promise<LocalAudioTrack> | undefined;
  private readonly clones = new Set<LocalAudioTrack>();

  constructor(
    create: () => Promise<LocalAudioTrack> = () => createLocalAudioTrack(),
    wrap: WrapTrack = (track) => new LocalAudioTrack(track, undefined, true),
  ) {
    this.create = create;
    this.wrap = wrap;
  }

  // ルームに publish するトラック。使い終えたら release に渡す
  async acquire(): Promise<LocalAudioTrack> {
    const source = await this.sourceTrack();
    const clone = this.wrap(source.mediaStreamTrack.clone());
    this.clones.add(clone);
    return clone;
  }

  // トラックを止める。どのルームも使わなくなったら、元のマイクも放す(マイク使用中の表示が消える)
  release(track: LocalAudioTrack): void {
    track.stop();
    if (!this.clones.delete(track) || this.clones.size > 0) {
      return;
    }
    const source = this.source;
    this.source = undefined;
    void source?.then((t) => t.stop()).catch(() => {});
  }

  private async sourceTrack(): Promise<LocalAudioTrack> {
    if (this.source) {
      try {
        const current = await this.source;
        if (current.mediaStreamTrack.readyState !== "ended") {
          return current;
        }
      } catch {
        // 前に取れなかった(権限を断られた、など)。取り直す
      }
    }
    const created = this.create();
    this.source = created;
    try {
      return await created;
    } catch (e) {
      if (this.source === created) {
        this.source = undefined;
      }
      throw e;
    }
  }
}
