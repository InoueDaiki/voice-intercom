import { Observable } from "../observable.ts";
import type { RoomSession } from "./roomSession.ts";

// 画面の見え方の変化。端末ごとの合図をこの3つにまとめる(設計メモの「Web 版のタブを裏に回したとき…」の案 B)。
// - inactive: フォーカスを失った(別のウィンドウに移った、通知を引き出した)。まだ見えていることもある
// - hidden: 隠れた(タブを裏に回した、画面を消した、ホームに戻った、ページを離れる)
// - visible: 見えるようになった
export type PresenceChange = "inactive" | "hidden" | "visible";

// 端末に依るところ: 画面が見えているか。Web 版は visibilitychange・pagehide・blur から、
// モバイル版は AppState(inactive・background・active)から作って差し込む
export interface AppPresence {
  isVisible(): boolean;
  // 解除する関数を返す
  subscribe(listener: (change: PresenceChange) => void): () => void;
}

// 端末に依るところ: 画面を勝手に消させない(Web 版は Screen Wake Lock)。使えない端末では何もしない。
// acquire は何度呼んでもよい(持っていれば何もしない)
export interface ScreenAwake {
  acquire(): void;
  release(): void;
}

// 入室に使うトークン(API の LiveKit トークンの発行)
export interface JoinToken {
  url: string;
  token: string;
}

export interface RoomKeeperOptions {
  session: RoomSession;
  // 入室・入り直しのたびに新しいトークンを取る
  getToken: () => Promise<JoinToken>;
  presence: AppPresence;
  awake?: ScreenAwake;
  // これ以上隠れていたら、戻ったときに「字幕と履歴で追える」と知らせる(ミリ秒)
  awayNoticeMs?: number;
  // テストで差し替える
  now?: () => number;
}

// 入室を保つ。画面の見え方に合わせて、PTT を離し、戻ったら入り直し、画面を消させない。
// - 隠れたら・フォーカスを失ったら、必ず PTT を離す(押したまま声を送り続けない。戻っても押した状態は戻さない)
// - 戻ったら、切断されていれば入り直す。音が止められていないかも確かめ直す
// - 音声をつないでいて見えている間は、画面を消させない
// - 音声をつないだまましばらく隠れていたら、戻ったときに、その間の声は字幕と履歴で追えると知らせる
export class RoomKeeper extends Observable {
  readonly session: RoomSession;
  // 入室・入り直しで、トークンを取れなかった・入れなかったときの誤り
  joinError: unknown;
  // 入り直している途中か
  rejoining = false;
  // 隠れていた間の声は字幕と履歴で追える、と知らせるか
  awayNotice = false;

  private readonly getToken: () => Promise<JoinToken>;
  private readonly presence: AppPresence;
  private readonly awake: ScreenAwake | undefined;
  private readonly awayNoticeMs: number;
  private readonly now: () => number;
  private readonly unsubscribes: (() => void)[] = [];
  private visible: boolean;
  private hiddenAt: number | undefined;
  private disposed = false;

  constructor(options: RoomKeeperOptions) {
    super();
    this.session = options.session;
    this.getToken = options.getToken;
    this.presence = options.presence;
    this.awake = options.awake;
    this.awayNoticeMs = options.awayNoticeMs ?? 5000;
    this.now = options.now ?? (() => Date.now());
    this.visible = this.presence.isVisible();
  }

  // 見え方を聞き始め、入室する。入室できなければ joinError に入れて投げる
  async start(): Promise<void> {
    this.unsubscribes.push(
      this.presence.subscribe((change) => this.onPresence(change)),
      this.session.subscribe(() => this.syncAwake()),
    );
    try {
      const t = await this.getToken();
      if (this.disposed) {
        return;
      }
      await this.session.connect(t.url, t.token);
    } catch (e) {
      if (!this.disposed) {
        this.joinError = e;
        this.changed();
      }
      throw e;
    }
  }

  // 切断されていれば入り直す(戻ったとき。画面の「入り直す」からも呼ぶ)
  async rejoin(): Promise<void> {
    if (this.rejoining || this.disposed || !this.session.canRejoin) {
      return;
    }
    this.rejoining = true;
    this.joinError = undefined;
    this.changed();
    try {
      const t = await this.getToken();
      if (!this.disposed) {
        await this.session.rejoin(t.url, t.token);
      }
    } catch (e) {
      // 入れなかった理由は session.error にも入る(トークンを取れなかったときは入らない)
      if (!this.disposed) {
        this.joinError = e;
      }
    } finally {
      this.rejoining = false;
      this.changed();
    }
  }

  dismissAwayNotice(): void {
    if (this.awayNotice) {
      this.awayNotice = false;
      this.changed();
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const u of this.unsubscribes.splice(0)) {
      u();
    }
    this.awake?.release();
  }

  private onPresence(change: PresenceChange): void {
    if (this.disposed) {
      return;
    }
    if (change === "visible") {
      this.onVisible();
      return;
    }
    // プライバシーのため、押しているかによらず必ず離す(マイクの操作が途中でも、最後はミュートにそろう)
    this.session.setPressing(false);
    if (change === "hidden") {
      this.visible = false;
      this.hiddenAt ??= this.now();
      this.syncAwake();
    }
  }

  private onVisible(): void {
    const wasHidden = this.hiddenAt !== undefined;
    const away = this.hiddenAt === undefined ? 0 : this.now() - this.hiddenAt;
    this.visible = true;
    this.hiddenAt = undefined;
    // 音声をつないだまましばらく隠れていた、または隠れている間に切断されていた(短くても聞けていない)ら
    // 知らせる。入室の前に隠れていただけ、音声をつないでいなかった(声を聞いていない)なら知らせない
    if (
      wasHidden &&
      this.session.audio &&
      ((away >= this.awayNoticeMs && this.session.connected) || this.session.canRejoin)
    ) {
      this.awayNotice = true;
      this.changed();
    }
    this.session.refreshAudioPlayback();
    // Wake Lock は隠れると外れるので、取り直す
    this.syncAwake();
    void this.rejoin();
  }

  // 音声をつないでいて見えている間だけ、画面を消させない
  private syncAwake(): void {
    if (!this.awake || this.disposed) {
      return;
    }
    if (this.visible && this.session.connected && this.session.audio) {
      this.awake.acquire();
    } else {
      this.awake.release();
    }
  }
}
