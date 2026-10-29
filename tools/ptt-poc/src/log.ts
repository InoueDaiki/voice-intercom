// 出来事の記録。ネイティブ(intercom-os)の出来事は起きた時刻(atMs)で、JS の出来事は記録した時刻で並べる。
// 最後に届いた push を 0 として、そこからの経過を出す(push から声が出るまでの時間を測る)

import { Observable } from "@voice-intercom/client-core";

export interface LogEntry {
  atMs: number;
  source: "native" | "js";
  type: string;
  detail?: string;
}

// 測る区間の目印。push から順に起きるはずのもの
export const MILESTONES = [
  "incomingPush",
  "jsStarted",
  "audioActivated",
  "loggedIn",
  "tokenFetched",
  "roomConnected",
  "remoteAudioSubscribed",
  "remoteSpeaking",
] as const;
export type Milestone = (typeof MILESTONES)[number];

class AppLog extends Observable {
  readonly entries: LogEntry[] = [];
  readonly jsStartedAtMs = Date.now();

  constructor() {
    super();
    this.add({ atMs: this.jsStartedAtMs, source: "js", type: "jsStarted" });
  }

  add(entry: LogEntry): void {
    // 起きた順に並べる(JS が起動する前の出来事は、起動の後に届く)
    let i = this.entries.length;
    while (i > 0 && this.entries[i - 1].atMs > entry.atMs) {
      i--;
    }
    this.entries.splice(i, 0, entry);
    console.info(`[ptt-poc] ${entry.source} ${entry.type}${entry.detail ? ` ${entry.detail}` : ""}`);
    this.changed();
  }

  js(type: string, detail?: string): void {
    this.add({ atMs: Date.now(), source: "js", type, detail });
  }

  // 最後の push と、そこから各目印までの経過(ミリ秒)。目印は push の後で最初のものを使う
  get sinceLastPush(): { pushAtMs: number; elapsed: Partial<Record<Milestone, number>> } | undefined {
    const push = this.entries.findLast((e) => e.type === "incomingPush");
    if (!push) {
      return undefined;
    }
    const elapsed: Partial<Record<Milestone, number>> = {};
    for (const m of MILESTONES) {
      // jsStarted は push より前のこともある(起動していたアプリに届いた)。そのときは出さない
      const hit = this.entries.find((e) => e.type === m && e.atMs >= push.atMs);
      if (hit) {
        elapsed[m] = hit.atMs - push.atMs;
      }
    }
    return { pushAtMs: push.atMs, elapsed };
  }

  toJson(): string {
    return JSON.stringify({ exportedAt: new Date().toISOString(), entries: this.entries }, null, 2);
  }
}

export const appLog = new AppLog();
