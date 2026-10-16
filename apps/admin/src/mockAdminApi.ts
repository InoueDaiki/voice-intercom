// 管理 API のモック。サーバーがなくても画面を確かめられるよう、メモリ上のデータで応答する。
// 開発サーバーで VITE_API_MOCK=1 のときだけ読み込む(adminApi.ts)。データは再読み込みで初期値に戻る。
//
// エラーの表示を確かめるための特別な ID:
//   - ルーム `forbidden`: 一覧には出るが、詳細を開くと 403
//   - ルーム ID `network-error` で作成: 通信の失敗
//   - 既にある ID で作成: 409、ない ID を開く: 404
//   - 履歴は `warehouse-a`(区切りのある発話、テキスト、画像、動画。ページングできる件数)と
//     `line_2`(ユーザー一覧にいない送信者)にある。`forbidden` の履歴は 403

import {
  ApiError,
  type AdminApi,
  type Room,
  type TimelineEvent,
  type TimelineMedia,
  type User,
} from "./adminApi.ts";

const now = () => new Date().toISOString();
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

const users: User[] = [
  { user_id: "11111111-aaaa-4000-8000-000000000001", display_name: "山田 太郎", language: "ja" },
  { user_id: "11111111-aaaa-4000-8000-000000000002", display_name: "Maria Silva", language: "pt" },
  { user_id: "11111111-aaaa-4000-8000-000000000003", display_name: "Nguyen Van An", language: "vi" },
  { user_id: "11111111-aaaa-4000-8000-000000000004", display_name: "Carlos García", language: "es" },
  { user_id: "11111111-aaaa-4000-8000-000000000005", display_name: "王 伟", language: "zh" },
  { user_id: "11111111-aaaa-4000-8000-000000000006", display_name: "John Smith", language: "en" },
  // どのルームにも入っていないユーザー
  { user_id: "11111111-aaaa-4000-8000-000000000007", display_name: "Kim Minji", language: "ko" },
].map((u, i) => ({
  ...u,
  language: u.language as User["language"],
  created_at: hoursAgo(240 - i * 20),
  updated_at: hoursAgo(200 - i * 20),
}));

const rooms = new Map<string, Room>(
  [
    {
      room_id: "warehouse-a",
      name: "A 倉庫",
      member_ids: [users[0]!.user_id, users[1]!.user_id, users[2]!.user_id],
      created_at: hoursAgo(72),
      updated_at: hoursAgo(3),
    },
    {
      room_id: "line_2",
      name: "第2ライン",
      // ユーザー一覧にいない sub(退職などで消えたユーザー)の表示を確かめる
      member_ids: [users[3]!.user_id, "99999999-dead-4000-8000-000000000000"],
      created_at: hoursAgo(48),
      updated_at: hoursAgo(30),
    },
    { room_id: "forbidden", name: "見られないルーム(403)", member_ids: [], created_at: hoursAgo(5), updated_at: hoursAgo(5) },
  ].map((r) => [r.room_id, r]),
);

// ---- ルームの履歴 ----

// 画像の代わりの小さな SVG。外部のサービスに頼らない
function svgImage(color: string, label: string, width: number, height: number): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="100%" height="100%" fill="${color}"/>` +
    `<text x="50%" y="50%" font-size="${Math.round(height / 8)}" fill="white" text-anchor="middle" dominant-baseline="middle">${label}</text>` +
    `</svg>`
  );
}
const dataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
// 本体は blob: の URL にする。data: の URL は新しいタブで開けない(ブラウザが止める)
const blobUrl = (content: string, type: string) => URL.createObjectURL(new Blob([content], { type }));

function media(
  id: string,
  contentType: TimelineMedia["content_type"],
  url: string,
  thumbnailUrl: string | null,
  sizeBytes: number,
  fileName: string | null = null,
): TimelineMedia {
  // 種類は API と同じ決め方にする(モックの画像の中身は SVG の blob だが、表示には影響しない)
  const mediaType = ["image/jpeg", "image/png", "image/webp", "image/heic"].includes(contentType)
    ? "image"
    : contentType.startsWith("video/")
      ? "video"
      : "file";
  return {
    media_id: id,
    content_type: contentType,
    media_type: mediaType,
    url,
    thumbnail_url: thumbnailUrl,
    size_bytes: sizeBytes,
    file_name: fileName,
  };
}

const secondsAgo = (s: number) => new Date(Date.now() - s * 1000).toISOString();

type Draft = Omit<
  TimelineEvent,
  "event_id" | "occurred_at" | "translations" | "media" | "utterance_id" | "segment_index"
> & {
  secondsAgo: number;
  sourceId: string;
  translations?: Record<string, string>;
  media?: TimelineMedia | null;
  utterance_id?: string | null;
  segment_index?: number | null;
};

function event(d: Draft): TimelineEvent {
  const occurredAt = secondsAgo(d.secondsAgo);
  const { secondsAgo: _s, sourceId, ...rest } = d;
  return {
    ...rest,
    translations: d.translations ?? {},
    media: d.media ?? null,
    utterance_id: d.utterance_id ?? null,
    segment_index: d.segment_index ?? null,
    occurred_at: occurredAt,
    event_id: `${occurredAt}#${sourceId}`,
  };
}

// 定型の言い回し(ページングを確かめるための件数を作る)
const phrases: Record<"ja" | "pt" | "vi" | "en", string>[] = [
  { ja: "次のパレットを3番に運んでください。", pt: "Leve o próximo palete para o número 3.", vi: "Hãy chuyển pallet tiếp theo đến số 3.", en: "Please move the next pallet to bay 3." },
  { ja: "了解しました。", pt: "Entendido.", vi: "Đã hiểu.", en: "Understood." },
  { ja: "フォークリフトが通ります。気をつけてください。", pt: "Empilhadeira passando. Cuidado.", vi: "Xe nâng đang đi qua. Hãy cẩn thận.", en: "Forklift coming through. Watch out." },
  { ja: "検品が終わりました。", pt: "A inspeção terminou.", vi: "Kiểm hàng đã xong.", en: "Inspection is done." },
  { ja: "10分休憩します。", pt: "Vou fazer uma pausa de 10 minutos.", vi: "Tôi nghỉ 10 phút.", en: "Taking a 10-minute break." },
];

function translationsExcept(row: Record<string, string>, language: string): Record<string, string> {
  return Object.fromEntries(Object.entries(row).filter(([code]) => code !== language));
}

const [yamada, maria, nguyen] = [users[0]!.user_id, users[1]!.user_id, users[2]!.user_id];

function warehouseTimeline(): TimelineEvent[] {
  const room_id = "warehouse-a";
  const events: TimelineEvent[] = [];
  // 区切りが3つある長い発話(segment 0 がいちばん古い)
  const longUtterance = [
    { ja: "午後の入荷ですが、トラックが30分ほど遅れています。", pt: "Sobre a entrega da tarde, o caminhão está cerca de 30 minutos atrasado.", vi: "Về hàng nhập buổi chiều, xe tải bị trễ khoảng 30 phút.", en: "About the afternoon delivery, the truck is about 30 minutes late." },
    { ja: "その間に、B列の棚を空けておいてください。", pt: "Enquanto isso, deixem as prateleiras da fileira B vazias.", vi: "Trong lúc đó, hãy dọn trống kệ hàng B.", en: "In the meantime, please clear the shelves in row B." },
    { ja: "終わったら私に一声かけてください。", pt: "Quando terminarem, me avisem.", vi: "Xong thì báo cho tôi nhé.", en: "Let me know when you're done." },
  ];
  longUtterance.forEach((row, i) => {
    events.push(
      event({
        room_id, kind: "utterance", sender_id: yamada, language: "ja", text: row.ja,
        translations: translationsExcept(row, "ja"),
        utterance_id: "utt-long-1", segment_index: i, sourceId: `utt-long-1-${i}`, secondsAgo: 60 - i * 8,
      }),
    );
  });
  // 区切りが2つある発話の間に、別の人のテキストが挟まる
  events.push(
    event({
      room_id, kind: "utterance", sender_id: maria, language: "pt", text: "Já estou indo para a fileira B,",
      translations: { ja: "今 B 列に向かっています、", vi: "Tôi đang đi đến dãy B,", en: "I'm heading to row B now," },
      utterance_id: "utt-2", segment_index: 0, sourceId: "utt-2-0", secondsAgo: 40,
    }),
    event({
      room_id, kind: "text", sender_id: nguyen, language: "vi", text: "Tôi sẽ giúp.",
      translations: { ja: "手伝います。", pt: "Eu vou ajudar.", en: "I'll help." },
      sourceId: "msg-help", secondsAgo: 36,
    }),
    event({
      room_id, kind: "utterance", sender_id: maria, language: "pt", text: "mas preciso de mais uma pessoa.",
      translations: { ja: "でも、もう1人必要です。", vi: "nhưng cần thêm một người nữa.", en: "but I need one more person." },
      utterance_id: "utt-2", segment_index: 1, sourceId: "utt-2-1", secondsAgo: 33,
    }),
  );
  // 画像(縮小画像あり / なし)、動画、ファイル
  const shelf = svgImage("#3b82f6", "B列の棚", 640, 480);
  events.push(
    event({
      room_id, kind: "media", sender_id: nguyen, language: "vi", text: "Kệ B đã trống.",
      translations: { ja: "B の棚が空きました。", pt: "A prateleira B está vazia.", en: "Shelf B is empty." },
      media: media("media-shelf", "image/png", blobUrl(shelf, "image/svg+xml"), dataUrl(svgImage("#3b82f6", "B列", 160, 120)), 48_213),
      sourceId: "media-shelf", secondsAgo: 25,
    }),
    event({
      room_id, kind: "media", sender_id: yamada, language: null, text: "",
      media: media("media-label", "image/png", blobUrl(svgImage("#16a34a", "ラベル", 320, 240), "image/svg+xml"), null, 12_034),
      sourceId: "media-label", secondsAgo: 18,
    }),
    event({
      room_id, kind: "media", sender_id: maria, language: "pt", text: "Vídeo do caminhão chegando.",
      translations: { ja: "トラックが着いたときの動画です。", vi: "Video xe tải đến.", en: "Video of the truck arriving." },
      // 再生できない空の動画。画面は「プレビューなし」になる
      media: media("media-truck", "video/mp4", blobUrl("", "video/mp4"), null, 3_481_920),
      sourceId: "media-truck", secondsAgo: 10,
    }),
    event({
      room_id, kind: "media", sender_id: yamada, language: null, text: "",
      media: media("media-doc", "application/pdf", blobUrl("%PDF-1.7", "application/pdf"), null, 254_120, "出荷指示書.pdf"),
      sourceId: "media-doc", secondsAgo: 8,
    }),
    // 言語がわからず、訳もない発話
    event({
      room_id, kind: "utterance", sender_id: nguyen, language: null, text: "(聞き取れませんでした)",
      utterance_id: "utt-unknown", segment_index: 0, sourceId: "utt-unknown-0", secondsAgo: 5,
    }),
  );
  // 古い履歴。1ページ(50件)に収まらない件数にする
  const senders: [string, "ja" | "pt" | "vi"][] = [
    [yamada, "ja"],
    [maria, "pt"],
    [nguyen, "vi"],
  ];
  for (let i = 0; i < 70; i++) {
    const [sender, language] = senders[i % senders.length]!;
    const row = phrases[i % phrases.length]!;
    const kind = i % 4 === 0 ? "text" : "utterance";
    const sourceId = kind === "text" ? `msg-old-${i}` : `utt-old-${i}-0`;
    events.push(
      event({
        room_id, kind, sender_id: sender, language, text: row[language],
        translations: translationsExcept(row, language),
        ...(kind === "utterance" && { utterance_id: `utt-old-${i}`, segment_index: 0 }),
        sourceId, secondsAgo: 3600 + i * 90,
      }),
    );
  }
  return events;
}

function line2Timeline(): TimelineEvent[] {
  const room_id = "line_2";
  return [
    event({
      room_id, kind: "utterance", sender_id: users[3]!.user_id, language: "es", text: "La línea 2 está parada.",
      translations: { ja: "2番ラインが止まっています。" }, utterance_id: "utt-l2-1", segment_index: 0,
      sourceId: "utt-l2-1-0", secondsAgo: 7200,
    }),
    // ユーザー一覧にいない送信者
    event({
      room_id, kind: "text", sender_id: "99999999-dead-4000-8000-000000000000", language: "ja", text: "確認します。",
      translations: { es: "Lo compruebo." }, sourceId: "msg-l2-1", secondsAgo: 7100,
    }),
  ];
}

const timeline: TimelineEvent[] = [...warehouseTimeline(), ...line2Timeline()];

// 通信の遅れを真似る
const delay = () => new Promise((resolve) => setTimeout(resolve, 300));
// 呼び出し側がデータを書き換えてもモックの中身が変わらないよう、写しを返す
const copy = <T>(value: T): T => structuredClone(value);

function find(roomId: string): Room {
  if (roomId === "forbidden") {
    throw new ApiError(403, "このルームを見る権限がありません");
  }
  const room = rooms.get(roomId);
  if (!room) {
    throw new ApiError(404, "Room not found");
  }
  return room;
}

export const mockAdminApi: AdminApi = {
  async listRooms() {
    await delay();
    return { items: copy([...rooms.values()]) };
  },
  async getRoom(roomId) {
    await delay();
    return copy(find(roomId));
  },
  async createRoom(body) {
    await delay();
    if (body.room_id === "network-error") {
      throw new ApiError(0);
    }
    if (rooms.has(body.room_id)) {
      throw new ApiError(409, "Room already exists");
    }
    const room: Room = { ...body, member_ids: body.member_ids ?? [], created_at: now(), updated_at: now() };
    rooms.set(room.room_id, room);
    return copy(room);
  },
  async updateRoom(roomId, body) {
    await delay();
    const room = find(roomId);
    Object.assign(room, body, { updated_at: now() });
    return copy(room);
  },
  async deleteRoom(roomId) {
    await delay();
    find(roomId);
    rooms.delete(roomId);
  },
  async listUsers() {
    await delay();
    return { items: copy(users) };
  },
  async listTimeline(roomId, query = {}) {
    await delay();
    find(roomId);
    // サーバーと同じく、新しい順に limit 件。before より古いものだけ
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
    const matched = timeline
      .filter((e) => e.room_id === roomId && (query.before === undefined || e.event_id < query.before))
      .sort((a, b) => b.event_id.localeCompare(a.event_id));
    const items = matched.slice(0, limit);
    const next_before = matched.length > limit ? items.at(-1)!.event_id : null;
    return { items: copy(items), next_before };
  },
};
