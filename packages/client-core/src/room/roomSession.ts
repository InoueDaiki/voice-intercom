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

import type { TimelineEvent } from "../api.ts";
import { Observable } from "../observable.ts";
import { CaptionBoard, type CaptionSegment } from "./captionBoard.ts";
import { DeletionReceiver } from "./deletionReceiver.ts";
import { MediaFeed } from "./mediaFeed.ts";
import { MediaReceiver } from "./mediaReceiver.ts";
import { shouldSubscribe } from "./subscription.ts";
import { TextSender } from "./textSender.ts";
import { captionTopic, deletionTopic, mediaTopic, textStatusTopic, textTopic } from "./topics.ts";

// 自分のテキストの履歴の行がまだ保存されていない(Agent は訳がそろってから保存する)
export class NotSavedYetError extends Error {
  constructor() {
    super("まだ履歴に保存されていない");
    this.name = "NotSavedYetError";
  }
}

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
  // 履歴の先頭のページ(新しい順)。無ければ topic media を捨て、自分のテキストを消せない
  fetchRecentTimeline?: () => Promise<TimelineEvent[]>;
  // 履歴の1件。無ければ topic deletion を捨てる(入り直したときの履歴の読み直しで反映される)
  fetchTimelineEvent?: (eventId: string) => Promise<TimelineEvent | null>;
  // 自分の送ったものを消し、墓石を返す
  deleteTimelineEvent?: (eventId: string) => Promise<TimelineEvent>;
  // 自分のテキストの行を履歴で探すとき、見つからなければ読み直すまでの間隔(ミリ秒)
  findTextRetryDelaysMs?: number[];
  // テストで差し替える
  room?: Room;
}

// データチャネルで受け取ったものの送信元。kind と identity だけを見る
export type DataSender = Pick<RemoteParticipant, "kind" | "identity">;

// 1つのルームへの接続。PTT、購読、字幕、テキスト入力、画像・動画の受け取りと削除を受け持つ。
// 画面は subscribe で変化を知り、プロパティを読み直す(React なら useSyncExternalStore)。
export class RoomSession extends Observable {
  readonly myIdentity: string;
  readonly myLanguage: string;
  readonly roomName: string;
  readonly room: Room;
  readonly captions = new CaptionBoard();
  // ルームの画面に出す画像・動画
  readonly media = new MediaFeed();
  readonly textSender: TextSender;
  // topic media の受け手。履歴を読めないときは undefined で、topic media を捨てる
  readonly mediaReceiver: MediaReceiver | undefined;
  // topic deletion の受け手。1件を読めないときは undefined で、topic deletion を捨てる
  readonly deletionReceiver: DeletionReceiver | undefined;
  // つなぎ直したときに呼ぶ(履歴を読み直して、切れていた間の画像・動画を埋める)
  onReconnected: (() => void) | undefined;

  connected = false;
  error: string | undefined;
  // 入室はできたが、知らせておくこと
  warning: string | undefined;
  // PTT を押しているか(利用者の操作)
  pressing = false;
  // マイクのミュートが外れているか(実際の状態)
  talking = false;
  // ブラウザの自動再生の制限で、音を鳴らせていないなら false(startAudio を利用者の操作から呼ぶ)
  canPlaybackAudio = true;

  private readonly platform: RoomPlatform;
  private readonly fetchRecent: (() => Promise<TimelineEvent[]>) | undefined;
  private readonly deleteEvent: ((eventId: string) => Promise<TimelineEvent>) | undefined;
  private readonly findTextRetryDelaysMs: number[];
  // 反映した墓石の event_id
  private readonly appliedDeletions = new Set<string>();
  private mic: LocalAudioTrack | undefined;
  private disposed = false;
  // ミュートの操作を順に1つずつ行うためのつなぎ
  private micOps: Promise<void> = Promise.resolve();

  constructor(options: RoomSessionOptions) {
    super();
    this.myIdentity = options.myIdentity;
    this.myLanguage = options.myLanguage;
    this.roomName = options.roomName;
    this.platform = options.platform ?? {};
    this.fetchRecent = options.fetchRecentTimeline;
    this.deleteEvent = options.deleteTimelineEvent;
    this.findTextRetryDelaysMs = options.findTextRetryDelaysMs ?? [1000, 2000, 4000];
    // 音声だけなので、映像の最適化は要らない
    this.room = options.room ?? new Room({ adaptiveStream: false, dynacast: false });
    // Agent を知ってから送る。知る前に Agent が返した字幕は捨てるため(TextSender)
    this.textSender = new TextSender({
      send: (m) => this.sendText(m),
      onChanged: () => this.changed(),
      canSend: () => this.agentPresent,
    });
    const fetchRecent = options.fetchRecentTimeline;
    this.mediaReceiver = fetchRecent
      ? new MediaReceiver({
          fetchRecent,
          onConfirmed: (events) => this.addMedia(events),
          isKnown: (id) => this.media.contains(id),
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

  async connect(url: string, token: string): Promise<void> {
    const room = this.room;
    room
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
      .on(RoomEvent.Reconnected, () => this.onReconnected?.())
      .on(RoomEvent.Disconnected, (reason) => {
        this.connected = false;
        this.talking = false;
        this.stopBackground();
        this.error ??= `切断された(${reason === undefined ? "理由不明" : DisconnectReason[reason]})`;
        this.changed();
      });
    try {
      await room.connect(url, token, { autoSubscribe: false });
      for (const p of room.remoteParticipants.values()) {
        for (const pub of p.audioTrackPublications.values()) {
          this.maybeSubscribe(p, pub);
        }
      }
      await this.publishMuted();
      // マイクの権限を得た後(publish の後)に始める。権限が無いとマイクのサービスにできない
      await this.startBackground();
      this.connected = true;
      this.canPlaybackAudio = room.canPlaybackAudio;
      this.changed();
    } catch (e) {
      this.stopBackground();
      this.error = `入室できなかった: ${e instanceof Error ? e.message : String(e)}`;
      this.changed();
      throw e;
    }
  }

  // 自動再生の制限で止まっている音を鳴らす。利用者の操作(クリックなど)の中で呼ぶ
  async startAudio(): Promise<void> {
    await this.room.startAudio();
  }

  // PTT の押し下げ。操作は順に行い、最後の状態に揃える
  setPressing(value: boolean): void {
    this.pressing = value;
    this.changed();
    this.micOps = this.micOps
      .then(() => this.applyMic())
      .catch((e: unknown) => {
        this.error = `マイクを切り替えられなかった: ${e instanceof Error ? e.message : String(e)}`;
        this.changed();
      });
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

  // 画像・動画を足す(complete の応答、履歴)。event_id で重ねない
  addMedia(events: Iterable<TimelineEvent>): void {
    if (this.media.addAll(events)) {
      this.changed();
    }
  }

  // 履歴の行を表示に反映する(入室とつなぎ直しで読んだ先頭のページ、確かめた墓石、自分の削除)。
  // 画像・動画は足し(墓石なら「削除された…」に置き換え)、消したテキストは字幕を
  // 「削除されたテキスト」にする。
  applyTimeline(rows: Iterable<TimelineEvent>): void {
    const list = [...rows];
    let changed = this.media.addAll(list);
    for (const row of list) {
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

  // 自分の送った画像・動画か(消す操作を出すか)
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
    let row: TimelineEvent | undefined;
    for (let i = 0; ; i++) {
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

  // 自分の送った画像・動画を消す
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
    this.textSender.dispose();
    this.mediaReceiver?.dispose();
    this.deletionReceiver?.dispose();
    this.room.removeAllListeners();
    void this.room.disconnect();
  }

  // マイクのトラックを、ミュートしたまま publish する。
  // 話す間だけミュートを外す(services/agent の README の「話者のトラック」)。
  private async publishMuted(): Promise<void> {
    const track = await createLocalAudioTrack();
    // publish の前にミュートしておくと、ミュートの状態で publish される(音が漏れない)。
    // マイクのミュートはトラックを止めずに無効にするだけ(Room の stopMicTrackOnMute が既定の false)なので、
    // 外すのが速い
    await track.mute();
    await this.room.localParticipant.publishTrack(track, { source: Track.Source.Microphone });
    this.mic = track;
  }

  private async applyMic(): Promise<void> {
    const mic = this.mic;
    if (!mic || this.disposed) {
      return;
    }
    const want = this.pressing && this.connected;
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
