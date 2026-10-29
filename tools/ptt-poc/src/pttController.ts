// spike の中心。intercom-os(Push to Talk の仕組み)の出来事を、client-core の RoomSession と WebRTC の音声につなぐ。
//
// - 話す: システムの画面かアプリのボタン → transmissionBegan → setPressing(true)(マイクのミュートを外す)
// - 音: システムが音声セッションを有効にした(audioActivated)ときにだけ、WebRTC の音声エンジンを動かす。
//   アプリが自分で有効にしてはいけない(Apple の決まり)ので、LiveKit の自動の設定は index.ts で切ってある
// - 受ける: ほかの人が話し始めたら(LiveKit の active speakers)setActiveRemoteParticipant で知らせ、
//   システムに音声セッションを有効にしてもらう。閉じたアプリでは push で起き、保存した設定で入室し直す

import { AudioDeviceModule, RTCAudioSession } from "@livekit/react-native-webrtc";
import { type ClientApi, createClientApi, Observable, RoomSession } from "@voice-intercom/client-core";
import { type PttEvent, type PttTransmissionMode, pttChannel } from "@voice-intercom/intercom-os";
import { type Participant, RoomEvent, Track } from "livekit-client";

import { appLog } from "./log";
import { apiBaseUrl, loadSettings, oidcBaseUrl, type PocSettings, saveSettings } from "./settings";

// 話し終えたとみなすまでの間(active speakers は話の途切れでも空になる)
const speakingHangoverMs = 1500;

export class PttController extends Observable {
  session: RoomSession | undefined;
  settings: PocSettings | undefined;
  pushToken: string | undefined;
  activeChannelId: string | undefined;
  transmitting = false;
  audioActive = false;
  remoteSpeaker: string | undefined;
  busy = false;
  error: string | undefined;

  private accessToken: string | undefined;
  private api: ClientApi | undefined;
  private entering: Promise<void> | undefined;
  private speakingTimer: ReturnType<typeof setTimeout> | undefined;

  get pttSupported(): boolean {
    return pttChannel !== undefined;
  }

  // アプリの起動で一度呼ぶ(画面を出す前)。閉じたアプリを起こした push の出来事も、ここで受け取る
  start(): void {
    void loadSettings().then((s) => {
      this.settings = s;
      this.changed();
    });
    if (!pttChannel) {
      appLog.js("pttUnavailable", "intercom-os のモジュールが無い。LiveKit の自動の音声セッションで動かす");
      return;
    }
    // システムが音声セッションを有効にするまで、エンジンを動かさない
    void this.setEngine(false);
    pttChannel.addListener((e) => this.onPttEvent(e));
  }

  private onPttEvent(e: PttEvent): void {
    const { type, atMs, ...rest } = e;
    appLog.add({ atMs, source: "native", type, detail: Object.keys(rest).length ? JSON.stringify(rest) : undefined });
    switch (e.type) {
      case "ready":
        this.activeChannelId = e.activeChannelId;
        break;
      case "joined":
        this.activeChannelId = e.channelId;
        void pttChannel?.setServiceStatus(this.session?.connected ? "ready" : "connecting");
        break;
      case "left":
        this.activeChannelId = undefined;
        break;
      case "pushToken":
        this.pushToken = e.token;
        break;
      case "incomingPush":
        // 入室していなければ(閉じていたアプリを起こした、裏で切れた)、保存した設定で入り直す
        void this.ensureEntered();
        break;
      case "audioActivated":
        this.audioActive = true;
        RTCAudioSession.audioSessionDidActivate();
        void this.setEngine(true);
        break;
      case "audioDeactivated":
        this.audioActive = false;
        void this.setEngine(false);
        RTCAudioSession.audioSessionDidDeactivate();
        break;
      case "transmissionBegan":
        this.transmitting = true;
        this.session?.setPressing(true);
        break;
      case "transmissionEnded":
        this.transmitting = false;
        this.session?.setPressing(false);
        break;
      case "error":
        this.error = `${e.operation}: ${e.message}`;
        break;
    }
    this.changed();
  }

  private async setEngine(available: boolean): Promise<void> {
    try {
      await AudioDeviceModule.setEngineAvailability({ isInputAvailable: available, isOutputAvailable: available });
      appLog.js(available ? "engineEnabled" : "engineDisabled");
    } catch (e) {
      appLog.js("engineError", String(e));
    }
  }

  // ---- 入室 ----

  async enter(settings: PocSettings): Promise<void> {
    await saveSettings(settings);
    this.settings = settings;
    await this.run(() => this.ensureEntered());
  }

  private ensureEntered(): Promise<void> {
    if (this.session?.connected) {
      return Promise.resolve();
    }
    this.entering ??= this.doEnter().finally(() => {
      this.entering = undefined;
    });
    return this.entering;
  }

  private async doEnter(): Promise<void> {
    const settings = this.settings ?? (await loadSettings());
    if (!settings) {
      appLog.js("enterSkipped", "設定が無い(一度アプリから入室する)");
      return;
    }
    this.settings = settings;
    this.session?.dispose();
    this.session = undefined;

    this.accessToken = await login(settings.username);
    appLog.js("loggedIn", settings.username);
    const api = createClientApi({ baseUrl: apiBaseUrl, getAccessToken: async () => this.accessToken ?? "" });
    this.api = api;
    const me = (await api.getMyProfile()) ?? (await api.putMyProfile(settings.username, "ja"));
    const room = await api.getRoom(settings.roomId);
    const lk = await api.createLiveKitToken(settings.roomId);
    appLog.js("tokenFetched");

    const session = new RoomSession({
      myIdentity: me.user_id,
      myLanguage: me.language,
      roomName: room.name,
      setAudioAttribute: (enabled) => api.setRoomAudio(settings.roomId, enabled).then(() => undefined),
    });
    this.session = session;
    this.listenRoom(session);
    session.subscribe(() => this.changed());
    await session.connect(lk.server_url, lk.participant_token);
    appLog.js("roomConnected", room.name);
    void pttChannel?.setServiceStatus("ready").catch(() => undefined);
    this.changed();
  }

  private listenRoom(session: RoomSession): void {
    const room = session.room;
    room
      .on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
        if (track.kind === Track.Kind.Audio) {
          appLog.js("remoteAudioSubscribed", participant.identity);
        }
      })
      .on(RoomEvent.ActiveSpeakersChanged, (speakers) => this.onActiveSpeakers(speakers))
      .on(RoomEvent.Disconnected, (reason) => {
        appLog.js("roomDisconnected", String(reason));
        void pttChannel?.setServiceStatus("connecting").catch(() => undefined);
        this.changed();
      })
      .on(RoomEvent.Reconnecting, () => appLog.js("roomReconnecting"))
      .on(RoomEvent.Reconnected, () => appLog.js("roomReconnected"));
  }

  // ほかの人(Agent の翻訳音声も含む)が話していれば、システムに話している人として知らせる
  private onActiveSpeakers(speakers: Participant[]): void {
    const remote = speakers.find((p) => !p.isLocal);
    if (remote) {
      clearTimeout(this.speakingTimer);
      this.speakingTimer = undefined;
      const name = remote.name || remote.identity;
      if (this.remoteSpeaker !== name) {
        this.remoteSpeaker = name;
        appLog.js("remoteSpeaking", name);
        this.setRemote(name);
      }
      return;
    }
    if (this.remoteSpeaker === undefined || this.speakingTimer !== undefined) {
      return;
    }
    this.speakingTimer = setTimeout(() => {
      this.speakingTimer = undefined;
      this.remoteSpeaker = undefined;
      appLog.js("remoteSilent");
      this.setRemote(null);
    }, speakingHangoverMs);
  }

  private setRemote(name: string | null): void {
    this.changed();
    if (!pttChannel || !this.activeChannelId) {
      return;
    }
    pttChannel.setActiveRemoteParticipant(name).catch((e: unknown) => appLog.js("setActiveRemoteError", String(e)));
  }

  // ---- Push to Talk のチャンネル ----

  async joinChannel(): Promise<void> {
    const settings = this.settings;
    const room = this.session?.roomName;
    if (!pttChannel || !settings) {
      return;
    }
    await this.run(async () => {
      const channelId = settings.channelId ?? crypto.randomUUID();
      if (channelId !== settings.channelId) {
        this.settings = { ...settings, channelId };
        await saveSettings(this.settings);
      }
      await pttChannel?.join(channelId, room ?? settings.roomId);
    });
  }

  leaveChannel(): Promise<void> {
    return this.run(async () => pttChannel?.leave());
  }

  setTransmissionMode(mode: PttTransmissionMode): Promise<void> {
    return this.run(async () => {
      await pttChannel?.setTransmissionMode(mode);
      appLog.js("transmissionMode", mode);
    });
  }

  // アプリの画面の「押して話す」。チャンネルがあればシステムを通し、無ければ直接ミュートを外す
  pressTalk(pressing: boolean): void {
    if (pttChannel && this.activeChannelId) {
      const op = pressing ? pttChannel.beginTransmitting() : pttChannel.stopTransmitting();
      op.catch((e: unknown) => appLog.js("transmitError", String(e)));
      return;
    }
    this.session?.setPressing(pressing);
  }

  async leaveRoom(): Promise<void> {
    this.session?.dispose();
    this.session = undefined;
    this.changed();
  }

  private async run(op: () => Promise<void>): Promise<void> {
    this.busy = true;
    this.error = undefined;
    this.changed();
    try {
      await op();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      appLog.js("error", this.error);
    } finally {
      this.busy = false;
      this.changed();
    }
  }
}

// 模擬 OIDC の password grant(PoC だけ。アプリはログインの画面で認可コードを使う)
async function login(username: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "password",
    username,
    password: "x",
    client_id: "mobile",
    scope: "openid",
  });
  const res = await fetch(`${oidcBaseUrl}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`ログインできなかった: ${res.status} ${await res.text()}`);
  }
  return ((await res.json()) as { access_token: string }).access_token;
}

export const controller = new PttController();
