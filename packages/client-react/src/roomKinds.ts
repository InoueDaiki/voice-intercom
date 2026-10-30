// ルームの種別の名前と説明(一覧、ルームの画面、作成と設定の画面で使う)。アイコンは各アプリで添える
// (Web は lucide-react、モバイル版は lucide-react-native。名前は同じ: Globe、Lock、Handshake)
import type { RoomKind } from "@voice-intercom/client-core";

export const ROOM_KIND_LABELS: Record<RoomKind, { label: string; description: string }> = {
  public: { label: "Public", description: "テナントの誰でも参加できる" },
  private: { label: "Private", description: "オーナーか管理者が招待した人だけが入れる" },
  connect: { label: "Connect", description: "ほかのテナントの人と一緒に使う。招待した人だけが入れる" },
};
