import { fromBinary, toBinary } from "@bufbuild/protobuf";
import { type Caption, CaptionSchema } from "@voice-intercom/schema/voiceintercom/v1/caption_pb";
import { type TextMessage, TextMessageSchema } from "@voice-intercom/schema/voiceintercom/v1/text_pb";
import { type TextStatus, TextStatusSchema } from "@voice-intercom/schema/voiceintercom/v1/text_status_pb";
import {
  createLocalAudioTrack,
  DisconnectReason,
  type LocalAudioTrack,
  ParticipantKind,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  Room,
  RoomEvent,
  Track,
} from "livekit-client";

import type { TimelineEvent, TimelinePage } from "../api.ts";
import { Observable } from "../observable.ts";
import { CAPTION_STALE_MS, CaptionBoard, type CaptionSegment } from "./captionBoard.ts";
import { DeletionReceiver } from "./deletionReceiver.ts";
import { MediaReceiver } from "./mediaReceiver.ts";
import { RoomTimeline, type TimelineEntry } from "./roomTimeline.ts";
import { shouldSubscribe } from "./subscription.ts";
import { TextSender } from "./textSender.ts";
import { captionTopic, deletionTopic, mediaTopic, textStatusTopic, textTopic } from "./topics.ts";

// 自分のテキストの履歴の行がまだ保存されていない(Agent は訳がそろってから保存する)
// 誤りの文言。React Native の WebRTC は Error ではない物(message を持つ)で失敗を返すことがある
function describeError(e: unknown): string {
  if (typeof e === "object" && e !== null && "message" in e && typeof e.message === "string") {
    return e.message;
  }
  return String(e);
}

export class NotSavedYetError extends Error {
  constructor() {
    super("まだ履歴に保存されていない");
    this.name = "NotSavedYetError";
  }
}

// 切断の理由のうち、自動で入り直さないもの。同じ人がほかで入室した(入り直すと追い出し合う)、
// 退室させられた、ルームが消された
const noRejoinReasons: ReadonlySet<DisconnectReason> = new Set([
  DisconnectReason.DUPLICATE_IDENTITY,
  DisconnectReason.PARTICIPANT_REMOVED,
  DisconnectReason.ROOM_DELETED,
]);

// 捨てた字幕の分の履歴を読み直す、最短の間隔(ミリ秒)。保存されなかった字幕で読み続けないように
const CAPTION_GAP_SYNC_INTERVAL_MS = 30_000;

// 端末に依るところ。各アプリが差し込む(無ければ何もしない)
export interface RoomPlatform {
  // 購読した音声トラックを鳴らす。Web 版は <audio> に付ける。React Native は SDK が鳴らすので要らない
  attachAudio?(track: RemoteTrack): void;
  detachAudio?(track: RemoteTrack): void;
  // 入室中、バックグラウンドでも音声を保つ(モバイル版)。マイクも保てたら true
  startBackground?(title: string): Promise<boolean>;
  stopBackground?(): Promise<void>;
}

export interface RoomSessionOptions {
  // 自分の LiveKit identity(Cognito の sub。API がトークンに入れる)
  myIdentity: string;
  // 自分の言語。この言語の翻訳音声と訳の字幕を受け取る
  myLanguage: string;
  // ルームの名前。入室中の通知に出す
  roomName: string;
  platform?: RoomPlatform;
  // 履歴の1ページ(新しい順。before より古いもの)。無ければ履歴を出さず、topic media を捨て、
  // 自分のテキストを消せない
  fetchTimelinePage?: (before: string | undefined) => Promise<TimelinePage>;
  // 履歴の1件。無ければ topic deletion を捨てる(入り直したときの履歴の読み直しで反映される)
  fetchTimelineEvent?: (eventId: string) => Promise<TimelineEvent | null>;
  // 自分の送ったものを消し、墓石を返す
  deleteTimelineEvent?: (eventId: string) => Promise<TimelineEvent>;
  // 自分のテキストの行を履歴で探すとき、見つからなければ読み直すまでの間隔(ミリ秒)
  findTextRetryDelaysMs?: number[];
  // 音声をつなぐ(マイクを publish し、音声を購読する)か。false ならデータだけでつなぐ(既定は true)。
  // 設計メモの「ユーザーの3つの状態の表し方」
  audio?: boolean;
  // つないだまま音声を切り替えたときに、参加者の属性 audio を変える(API の PUT /rooms/{room_id}/audio)。
  // Agent は、audio が on の人の言語にだけ翻訳の音声と読み上げを作る
  setAudioAttribute?: (enabled: boolean) => Promise<void>;
  // マイクのトラックを作る・放す。複数のルームで1本のマイクを分けて使うときに差し替える(SharedMicrophone)
  createMicTrack?: () => Promise<LocalAudioTrack>;
  releaseMicTrack?: (track: LocalAudioTrack) => void;
  // テストで差し替える
  room?: Room;
}

// データチャネルで受け取ったものの送信元。kind と identity だけを見る
export type DataSender = Pick<RemoteParticipant, "kind" | "identity">;

// 1つのルームへの接続。PTT、購読、字幕、テキスト入力、タイムライン(履歴と字幕)、
// 画像・動画・ファイルの受け取りと削除を受け持つ。
// 画面は subscribe で変化を知り、プロパティを読み直す(React なら useSyncExternalStore)。
export class RoomSession extends Observable {
  readonly myIdentity: string;
  readonly myLanguage: string;
  // 入室中に改名されたら RoomHub が変える。次にバックグラウンドの音声を始めるときの通知から使う
  roomName: string;
  readonly room: Room;
  readonly captions = new CaptionBoard({ onEvicted: (s) => this.onCaptionEvicted(s) });
  // 履歴の行。字幕と合わせて1本のタイムラインにする(entries)
  readonly timeline: RoomTimeline;
  readonly textSender: TextSender;
  // topic media の受け手。履歴を読めないときは undefined で、topic media を捨てる
  readonly mediaReceiver: MediaReceiver | undefined;
  // topic deletion の受け手。1件を読めないときは undefined で、topic deletion を捨てる
  readonly deletionReceiver: DeletionReceiver | undefined;
  // つなぎ直したとき・入り直したときに呼ぶ
  onReconnected: (() => void) | undefined;

  connected = false;
  // 入室の途中か(最初の入室と、入り直し)
  joining = false;
  // 切断されたときの理由(入り直すと消す)
  disconnectReason: DisconnectReason | undefined;
  error: string | undefined;
  // 入室はできたが、知らせておくこと
  warning: string | undefined;
  // PTT を押しているか(利用者の操作)
  pressing = false;
  // マイクのミュートが外れているか(実際の状態)
  talking = false;
  // ブラウザの自動再生の制限で、音を鳴らせていないなら false(startAudio を利用者の操作から呼ぶ)
  canPlaybackAudio = true;
  // 音声をつないでいるか(利用者の選択)。false ならデータだけでつなぐ(タイムラインを見て、送れる)
  audio: boolean;
  // 音声の切り替えの途中か
  switchingAudio = false;

  private readonly platform: RoomPlatform;
  private readonly fetchRecent: (() => Promise<TimelineEvent[]>) | undefined;
  private readonly hasHistory: boolean;
  private readonly deleteEvent: ((eventId: string) => Promise<TimelineEvent>) | undefined;
  private readonly findTextRetryDelaysMs: number[];
  private readonly createMicTrack: () => Promise<LocalAudioTrack>;
  private readonly releaseMicTrack: (track: LocalAudioTrack) => void;
  private readonly setAudioAttribute: ((enabled: boolean) => Promise<void>) | undefined;
  // 参加者の属性 audio に入っている値(トークンで入れた値か、最後に API で変えた値)
  private attributeAudio: boolean | undefined;
  // 反映した墓石の event_id
  private readonly appliedDeletions = new Set<string>();
  private mic: LocalAudioTrack | undefined;
  private disposed = false;
  // 一度でも入室できたか
  private joined = false;
  // 最初の入室に失敗したまま、まだ入れていないか
  private joinFailed = false;
  // 捨てた字幕の分の履歴を読み直す予定と、前回読み直した時刻
  private captionGapTimer: ReturnType<typeof setTimeout> | undefined;
  private lastCaptionGapSyncAt = 0;
  // 確定しないまま途切れた字幕を、受信中でなくすための描き直しの予定
  private captionStaleTimer: ReturnType<typeof setTimeout> | undefined;
  // Room のイベントを聞き始めたか(入り直しでは同じ Room を使い、聞き直さない)
  private listening = false;
  // ミュートの操作を順に1つずつ行うためのつなぎ
  private micOps: Promise<void> = Promise.resolve();

  constructor(options: RoomSessionOptions) {
    super();
    this.myIdentity = options.myIdentity;
    this.myLanguage = options.myLanguage;
    this.roomName = options.roomName;
    this.platform = options.platform ?? {};
    const fetchPage = options.fetchTimelinePage;
    this.hasHistory = fetchPage !== undefined;
    this.fetchRecent = fetchPage && (async () => (await fetchPage(undefined)).items);
    this.timeline = new RoomTimeline({
      fetchPage: fetchPage ?? (async () => ({ items: [], next_before: null })),
      onChanged: () => this.changed(),
    });
    this.deleteEvent = options.deleteTimelineEvent;
    this.findTextRetryDelaysMs = options.findTextRetryDelaysMs ?? [1000, 2000, 4000];
    // 音声だけなので、映像の最適化は要らない
    this.room = options.room ?? new Room({ adaptiveStream: false, dynacast: false });
    this.createMicTrack = options.createMicTrack ?? (() => createLocalAudioTrack());
    this.releaseMicTrack = options.releaseMicTrack ?? ((track) => track.stop());
    this.setAudioAttribute = options.setAudioAttribute;
    this.audio = options.audio ?? true;
    // Agent を知ってから送る。知る前に Agent が返した字幕は捨てるため(TextSender)
    this.textSender = new TextSender({
      send: (m) => this.sendText(m),
      onChanged: () => this.changed(),
      canSend: () => this.agentPresent,
    });
    const fetchRecent = this.fetchRecent;
    this.mediaReceiver = fetchRecent
      ? new MediaReceiver({
          fetchRecent,
          onConfirmed: (events) => this.addMedia(events),
          isKnown: (id) => this.timeline.contains(id),
        })
      : undefined;
    const fetchOne = options.fetchTimelineEvent;
    this.deletionReceiver = fetchOne
      ? new DeletionReceiver({
          fetchEvent: fetchOne,
          onConfirmed: (row) => this.applyTimeline([row]),
          isApplied: (id) => this.appliedDeletions.has(id),
        })
      : undefined;
  }

  // token は、今の audio で取ったもの(参加者の属性 audio に入る)
  async connect(url: string, token: string): Promise<void> {
    this.listen();
    this.joining = true;
    this.attributeAudio = this.audio;
    this.changed();
    try {
      await this.join(url, token);
    } finally {
      this.joining = false;
      this.changed();
    }
  }

  // 入り直せるか。切断された、または最初の入室に失敗した後で、追い出されたのではないとき
  get canRejoin(): boolean {
    return (
      (this.joined || this.joinFailed) &&
      !this.connected &&
      !this.joining &&
      !this.disposed &&
      (this.disconnectReason === undefined || !noRejoinReasons.has(this.disconnectReason))
    );
  }

  // 切断された後・入室に失敗した後に、同じ Room で入り直す(新しいトークンで)。マイクを作り直してミュートのまま publish し、
  // 履歴を読み直して切れていた間の行を埋める(つなぎ直しと同じ)。PTT は押していない状態で入る
  async rejoin(url: string, token: string): Promise<void> {
    if (!this.canRejoin) {
      return;
    }
    this.error = undefined;
    this.disconnectReason = undefined;
    this.pressing = false;
    await this.connect(url, token);
    if (this.connected) {
      this.onReconnected?.();
    }
  }

  private listen(): void {
    if (this.listening) {
      return;
    }
    this.listening = true;
    this.room
      .on(RoomEvent.TrackPublished, (pub, p) => this.maybeSubscribe(p, pub))
      .on(RoomEvent.DataReceived, (payload, p, _kind, topic) => this.handleData(payload, p, topic))
      .on(RoomEvent.ParticipantConnected, (p) => {
        if (p.kind === ParticipantKind.AGENT) {
          this.textSender.resume();
        }
        this.changed();
      })
      .on(RoomEvent.ParticipantDisconnected, () => this.changed())
      .on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === Track.Kind.Audio) {
          this.platform.attachAudio?.(track);
        }
        this.changed();
      })
      .on(RoomEvent.TrackUnsubscribed, (track) => {
        if (track.kind === Track.Kind.Audio) {
          this.platform.detachAudio?.(track);
        }
      })
      .on(RoomEvent.AudioPlaybackStatusChanged, (canPlayback) => {
        this.canPlaybackAudio = canPlayback;
        this.changed();
      })
      .on(RoomEvent.Reconnected, () => {
        // つながっていなかった間の行(画像・動画、削除、字幕の行)を埋める
        void this.syncHistory();
        this.onReconnected?.();
      })
      .on(RoomEvent.Disconnected, (reason) => {
        this.connected = false;
        this.talking = false;
        this.disconnectReason = reason;
        // 切断で SDK が unpublish して止めるが、念のため止めて放す(入り直すときに作り直す)
        this.dropMic();
        this.stopBackground();
        this.error ??= `切断された(${reason === undefined ? "理由不明" : DisconnectReason[reason]})`;
        this.changed();
      });
  }

  private async join(url: string, token: string): Promise<void> {
    const room = this.room;
    // 入室の途中で dispose されたら(入室中に画面を離れた)、そこでやめる。エラーにはしない
    try {
      await room.connect(url, token, { autoSubscribe: false });
      if (this.disposed) {
        return;
      }
      if (this.audio) {
        await this.startAudioIo();
      }
      if (this.disposed) {
        // 始めている間に dispose された。dispose の止める操作より後に始まったので、止め直す
        this.stopBackground();
        return;
      }
      this.connected = true;
      this.joined = true;
      this.joinFailed = false;
      this.canPlaybackAudio = room.canPlaybackAudio;
      this.changed();
      // 入室を待つ間に音声を切り替えていたら、ここで揃える
      this.queueMicOp(() => this.applyAudio());
      // 入室を待つ間に PTT を押していたら、ここでミュートを外す
      this.queueApplyMic();
      void this.syncHistory();
    } catch (e) {
      this.stopBackground();
      if (this.disposed) {
        return;
      }
      this.joinFailed = true;
      this.error = `入室できなかった: ${e instanceof Error ? e.message : String(e)}`;
      this.changed();
      throw e;
    }
  }

  // 自動再生の制限で止まっている音を鳴らす。利用者の操作(クリックなど)の中で呼ぶ
  async startAudio(): Promise<void> {
    await this.room.startAudio();
  }

  // 音を鳴らせているかを確かめ直す(画面に戻ったとき)。止められていれば「音を出す」を出す
  refreshAudioPlayback(): void {
    if (!this.connected || this.canPlaybackAudio === this.room.canPlaybackAudio) {
      return;
    }
    this.canPlaybackAudio = this.room.canPlaybackAudio;
    this.changed();
  }

  // PTT の押し下げ。操作は順に行い、最後の状態に揃える。音声をつないでいなければ何もしない
  setPressing(value: boolean): void {
    if (value && !this.audio) {
      return;
    }
    this.pressing = value;
    this.changed();
    this.queueApplyMic();
  }

  // 音声をつなぐ・切る(マイクの publish、音声の購読、参加者の属性 audio)。操作は順に行い、最後の状態に揃える。
  // つないでいないときは、次に入るときに使う(トークンも audio で取る)
  setAudio(value: boolean): Promise<void> {
    if (this.audio === value) {
      return this.micOps;
    }
    this.audio = value;
    if (!value) {
      this.pressing = false;
    }
    this.changed();
    this.queueApplyMic();
    return this.queueMicOp(() => this.applyAudio());
  }

  // マイクを pressing と connected に揃える操作を、つなぎの後ろに足す
  private queueApplyMic(): void {
    void this.queueMicOp(() => this.applyMic());
  }

  // マイクの操作(ミュート、publish、購読)を、つなぎの後ろに足す。終わったら解決する(失敗しても投げない)
  private queueMicOp(op: () => Promise<void>): Promise<void> {
    this.micOps = this.micOps.then(op).catch((e: unknown) => {
      this.error = `音声を切り替えられなかった: ${describeError(e)}`;
      this.changed();
    });
    return this.micOps;
  }

  // つないでいる間、マイク・購読・属性を audio に揃える
  private async applyAudio(): Promise<void> {
    if (!this.connected || this.disposed) {
      return;
    }
    const want = this.audio;
    this.switchingAudio = true;
    this.changed();
    try {
      if (want && !this.mic) {
        await this.startAudioIo();
      } else if (!want) {
        this.stopAudioIo();
      }
      if (this.attributeAudio !== want && this.setAudioAttribute && !this.disposed) {
        await this.setAudioAttribute(want);
        this.attributeAudio = want;
      }
    } finally {
      this.switchingAudio = false;
      this.changed();
    }
  }

  // マイクをミュートのまま publish し、音声を購読し、バックグラウンドの音声を始める
  private async startAudioIo(): Promise<void> {
    for (const p of this.room.remoteParticipants.values()) {
      for (const pub of p.audioTrackPublications.values()) {
        this.maybeSubscribe(p, pub);
      }
    }
    await this.publishMuted();
    // マイクの権限を得た後(publish の後)に始める。権限が無いとマイクのサービスにできない
    await this.startBackground();
  }

  // マイクを unpublish して放し、音声の購読をやめる(データだけでつながったままにする)
  private stopAudioIo(): void {
    const mic = this.mic;
    if (mic) {
      this.mic = undefined;
      this.talking = false;
      void this.room.localParticipant.unpublishTrack(mic, false).catch((e: unknown) => {
        console.warn("マイクを unpublish できなかった", e);
      });
      this.releaseMicTrack(mic);
    }
    for (const p of this.room.remoteParticipants.values()) {
      for (const pub of p.audioTrackPublications.values()) {
        if (pub.isSubscribed) {
          pub.setSubscribed(false);
        }
      }
    }
    this.stopBackground();
  }

  // データチャネルで受け取ったもの(テストでは Room を通さずに渡す)
  handleData(payload: Uint8Array, sender: DataSender | undefined, topic: string | undefined): void {
    switch (topic) {
      case deletionTopic: {
        // 画像・動画の配信と同じく、送信元の参加者があるものは捨て、無いものも履歴で確かめる
        const result = this.deletionReceiver?.receive(payload, sender !== undefined);
        if (result === "fromParticipant") {
          console.info("参加者が送った topic deletion を捨てた", sender?.identity);
        }
        return;
      }
      case mediaTopic: {
        // 送信元の参加者があるものは捨て、無いものも履歴で確かめてから出す(MediaReceiver)
        const result = this.mediaReceiver?.receive(payload, sender !== undefined);
        if (result === "fromParticipant") {
          console.info("参加者が送った topic media を捨てた", sender?.identity);
        }
        return;
      }
      case textStatusTopic:
        this.onTextStatus(payload, sender);
        return;
      case captionTopic:
        this.onCaption(payload, sender);
        return;
    }
  }

  // 送信元が Agent の参加者か。kind は LiveKit サーバーが配る参加者の情報から SDK が入れるもので、
  // 送信元の参加者もサーバーが付ける identity で引くので、参加者は偽れない
  static isFromAgent(sender: DataSender | undefined): boolean {
    return sender?.kind === ParticipantKind.AGENT;
  }

  // 確定が届かないまま途切れたときも、受信中の表示が消えるよう描き直す
  private scheduleCaptionStale(): void {
    if (this.captionStaleTimer !== undefined) {
      clearTimeout(this.captionStaleTimer);
    }
    this.captionStaleTimer = setTimeout(() => this.changed(), CAPTION_STALE_MS);
  }

  // 字幕を上限で捨てた。履歴の行がまだ無ければ、読み足さないと穴が空く(行は入室とつなぎ直しでしか読まない)。
  // 履歴に残らない字幕もあるので、読み直しの間隔を空ける
  private onCaptionEvicted(segment: CaptionSegment): void {
    if (
      !this.hasHistory ||
      this.disposed ||
      segment.isEmpty ||
      this.timeline.hasRowFor(segment.segmentId) ||
      this.captionGapTimer !== undefined
    ) {
      return;
    }
    const wait = Math.max(0, this.lastCaptionGapSyncAt + CAPTION_GAP_SYNC_INTERVAL_MS - Date.now());
    this.captionGapTimer = setTimeout(() => {
      this.captionGapTimer = undefined;
      this.lastCaptionGapSyncAt = Date.now();
      void this.syncHistory();
    }, wait);
  }

  // 字幕は Agent だけが送る。参加者は topic を偽れる(canPublishData は topic を限れない)ので、
  // 送信元が Agent の参加者のものだけを読む。受け手が Agent を知る前(Agent が入ってから約3秒)に
  // 届いたものは送信元が無く、これも捨てる(設計メモの「字幕の送信元」)
  private onCaption(payload: Uint8Array, sender: DataSender | undefined): void {
    if (!RoomSession.isFromAgent(sender)) {
      console.info("Agent 以外が送った topic caption を捨てた", sender?.identity);
      return;
    }
    let caption: Caption;
    try {
      caption = fromBinary(CaptionSchema, payload);
    } catch {
      return;
    }
    this.captions.apply(caption);
    if (!caption.isFinal) {
      this.scheduleCaptionStale();
    }
    if (caption.messageId !== "" && caption.speakerIdentity === this.myIdentity) {
      this.textSender.acknowledge(caption.messageId);
    }
    this.changed();
  }

  // テキスト入力の受け付け・結果。字幕と同じく、送信者を偽れるので Agent の参加者からのものだけ読む。
  // 自分に宛てたもの(destination_identities)しか届かないので、自分の送ったテキストのもの
  private onTextStatus(payload: Uint8Array, sender: DataSender | undefined): void {
    if (!RoomSession.isFromAgent(sender)) {
      console.info("Agent 以外が送った topic text_status を捨てた", sender?.identity);
      return;
    }
    let status: TextStatus;
    try {
      status = fromBinary(TextStatusSchema, payload);
    } catch {
      return;
    }
    this.textSender.applyStatus(status);
  }

  private async sendText(message: TextMessage): Promise<void> {
    if (this.room.state !== "connected") {
      throw new Error("入室していない");
    }
    await this.room.localParticipant.publishData(toBinary(TextMessageSchema, message), {
      reliable: true,
      topic: textTopic,
    });
  }

  // 字幕と履歴の行を時刻の順に並べたタイムライン
  get entries(): TimelineEntry[] {
    return this.timeline.entries(this.captions);
  }

  // 古いほうの履歴を1ページ読み足す(上へ戻ったとき)
  loadOlder(): Promise<void> {
    return this.hasHistory ? this.timeline.loadOlder() : Promise.resolve();
  }

  // 失敗した読み足しをやり直す(画面の操作から呼ぶ)
  retryOlder(): Promise<void> {
    return this.hasHistory ? this.timeline.retryOlder() : Promise.resolve();
  }

  // 最新の履歴を読み、行と墓石を反映する(入室とつなぎ直し)
  private async syncHistory(): Promise<void> {
    if (!this.hasHistory || this.disposed) {
      return;
    }
    await this.timeline.syncLatest();
    this.applyTimeline([]);
  }

  // 画像・動画・ファイルを足す(complete の応答、確かめた配信)。event_id で重ねない
  addMedia(events: Iterable<TimelineEvent>): void {
    if (this.timeline.addAll(events)) {
      this.changed();
    }
  }

  // 履歴の行を表示に反映する(入室とつなぎ直しで読んだ先頭のページ、確かめた墓石、自分の削除)。
  // 画像・動画は足し(墓石なら「削除された…」に置き換え)、消したテキストは字幕を
  // 「削除されたテキスト」にする。
  applyTimeline(rows: Iterable<TimelineEvent>): void {
    const list = [...rows];
    let changed = this.timeline.addAll(list);
    // 読み込んだ行(syncLatest、loadOlder)の墓石も、字幕に反映する
    for (const row of [...list, ...this.timeline.deletedTexts()]) {
      if (row.deleted == null) {
        continue;
      }
      if (!this.appliedDeletions.has(row.event_id)) {
        this.appliedDeletions.add(row.event_id);
        changed = true;
      }
      if (row.kind === "text") {
        this.captions.markTextDeleted(row.sender_id, row.message_id ?? "");
      }
    }
    if (changed) {
      this.changed();
    }
  }

  // タイムラインの1件を消せるか(自分の送ったテキスト・画像・動画・ファイルで、まだ消していない)
  canDeleteEntry(entry: TimelineEntry): boolean {
    if (entry.event) {
      return this.canDeleteMedia(entry.event) && entry.event.kind !== "utterance";
    }
    return entry.type === "caption" && entry.segment !== undefined && this.canDeleteCaption(entry.segment);
  }

  // タイムラインの1件を消す。履歴の行があればその event_id で、字幕だけなら行を探して消す
  async deleteEntry(entry: TimelineEntry): Promise<void> {
    if (entry.event) {
      await this.deleteOwnMedia(entry.event);
      return;
    }
    if (entry.type === "caption" && entry.segment) {
      await this.deleteOwnText(entry.segment);
    }
  }

  // 自分の送ったテキストか(消す操作を出すか)
  canDeleteCaption(segment: CaptionSegment): boolean {
    return (
      this.deleteEvent !== undefined &&
      this.fetchRecent !== undefined &&
      segment.isText &&
      !segment.deleted &&
      segment.speakerIdentity === this.myIdentity
    );
  }

  // 自分の送った行か(消す操作を出すか)
  canDeleteMedia(event: TimelineEvent): boolean {
    return this.deleteEvent !== undefined && event.deleted == null && event.sender_id === this.myIdentity;
  }

  // 自分の送ったテキストを消す。履歴の行は Agent が訳をそろえてから保存するので、
  // message_id の行を先頭のページで探し、無ければ findTextRetryDelaysMs の間隔で読み直す。
  // それでも無ければ NotSavedYetError。
  async deleteOwnText(segment: CaptionSegment): Promise<void> {
    const fetch = this.fetchRecent;
    const remove = this.deleteEvent;
    if (!fetch || !remove || !segment.isText) {
      throw new Error("消せない字幕");
    }
    let row = this.timeline.findText(this.myIdentity, segment.messageId);
    for (let i = 0; !row; i++) {
      const rows = await fetch();
      row = rows.find(
        (r) => r.kind === "text" && r.sender_id === this.myIdentity && r.message_id === segment.messageId,
      );
      if (row || i >= this.findTextRetryDelaysMs.length || this.disposed) {
        break;
      }
      await delay(this.findTextRetryDelaysMs[i] ?? 0);
    }
    if (!row) {
      throw new NotSavedYetError();
    }
    const tombstone = await remove(row.event_id);
    if (!this.disposed) {
      this.applyTimeline([tombstone]);
    }
  }

  // 自分の送ったもの(履歴の行)を消す
  async deleteOwnMedia(event: TimelineEvent): Promise<void> {
    const remove = this.deleteEvent;
    if (!remove) {
      throw new Error("消せない");
    }
    const tombstone = await remove(event.event_id);
    if (!this.disposed) {
      this.applyTimeline([tombstone]);
    }
  }

  // identity から表示名を引く。自分なら「自分」
  displayName(identity: string): string {
    if (identity === this.myIdentity) {
      return "自分";
    }
    const p = this.room.getParticipantByIdentity(identity);
    return p?.name || identity;
  }

  // 自分を含む、Agent 以外の参加者の数
  get participantCount(): number {
    return [...this.room.remoteParticipants.values()].filter((p) => p.kind !== ParticipantKind.AGENT).length + 1;
  }

  get agentPresent(): boolean {
    return [...this.room.remoteParticipants.values()].some((p) => p.kind === ParticipantKind.AGENT);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.stopBackground();
    // マイクを放す(ブラウザのマイク使用中の表示を消す)
    this.dropMic();
    this.textSender.dispose();
    this.mediaReceiver?.dispose();
    this.deletionReceiver?.dispose();
    for (const timer of [this.captionGapTimer, this.captionStaleTimer]) {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
    // 下で聞くのをやめるので、切断の TrackUnsubscribed は届かない。鳴らしている音声はここで外す
    // (Web 版なら <audio> が body に残らないように)
    for (const p of this.room.remoteParticipants.values()) {
      for (const pub of p.audioTrackPublications.values()) {
        if (pub.track) {
          this.platform.detachAudio?.(pub.track);
        }
      }
    }
    this.room.removeAllListeners();
    void this.room.disconnect();
  }

  // マイクのトラックを、ミュートしたまま publish する。
  // 話す間だけミュートを外す(services/agent の README の「話者のトラック」)。
  private dropMic(): void {
    const mic = this.mic;
    this.mic = undefined;
    if (mic) {
      this.releaseMicTrack(mic);
    }
  }

  private async publishMuted(): Promise<void> {
    const track = await this.createMicTrack();
    if (this.disposed || !this.audio) {
      this.releaseMicTrack(track);
      return;
    }
    // publish の前にミュートしておくと、ミュートの状態で publish される(音が漏れない)。
    // マイクのミュートはトラックを止めずに無効にするだけ(Room の stopMicTrackOnMute が既定の false)なので、
    // 外すのが速い
    try {
      await track.mute();
      await this.room.localParticipant.publishTrack(track, { source: Track.Source.Microphone });
    } catch (e) {
      // publish できなかったトラックは誰も止めないので、ここで止める(マイクを掴んだままにしない)
      this.releaseMicTrack(track);
      throw e;
    }
    if (this.disposed) {
      this.releaseMicTrack(track);
      return;
    }
    this.mic = track;
  }

  private async applyMic(): Promise<void> {
    const mic = this.mic;
    if (!mic || this.disposed) {
      return;
    }
    const want = this.pressing && this.connected && this.audio;
    if (want === this.talking) {
      return;
    }
    // ミュートの操作は必ず await する。終わる前に次の操作をすると、ミュートが効く前に音が漏れる
    // 競合がある(設計メモの「PTT の方式」)
    if (want) {
      await mic.unmute();
    } else {
      await mic.mute();
    }
    this.talking = want;
    this.changed();
  }

  private maybeSubscribe(p: RemoteParticipant, pub: RemoteTrackPublication): void {
    // 音声をつないでいない間は、何も購読しない(データだけ)
    if (!this.audio) {
      return;
    }
    const subscribe = shouldSubscribe({
      isAudio: pub.kind === Track.Kind.Audio,
      fromAgent: p.kind === ParticipantKind.AGENT,
      isMicrophone: pub.source === Track.Source.Microphone,
      trackName: pub.trackName,
      myLanguage: this.myLanguage,
    });
    if (subscribe && !pub.isSubscribed) {
      pub.setSubscribed(true);
    }
  }

  // バックグラウンドでの音声を保つ。始められなくても入室は止めない(前面にいる間は使える)
  private async startBackground(): Promise<void> {
    const start = this.platform.startBackground;
    if (this.disposed || !start) {
      return;
    }
    try {
      const withMic = await start.call(this.platform, `${this.roomName} に入室中`);
      if (!withMic) {
        this.warn("マイクの権限が無いので、バックグラウンドでは受信だけになる");
      }
    } catch (e) {
      console.warn("バックグラウンドの音声を始められなかった", e);
      this.warn("バックグラウンドに回ると音声が止まることがある");
    }
  }

  private stopBackground(): void {
    this.platform.stopBackground?.().catch((e: unknown) => console.warn("バックグラウンドの音声を止められなかった", e));
  }

  private warn(message: string): void {
    this.warning = this.warning === undefined ? message : `${this.warning}\n${message}`;
  }

  protected override changed(): void {
    if (!this.disposed) {
      super.changed();
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
