// ルームの種別の名前・説明・アイコン(一覧、ルームの画面、作成と設定の画面で使う)
import type { RoomKind } from "@voice-intercom/client-core";
import { Badge } from "@voice-intercom/ui-web";
import { Globe, Handshake, Lock, type LucideIcon } from "lucide-react";

export const ROOM_KINDS: Record<RoomKind, { label: string; description: string; Icon: LucideIcon }> = {
  public: { label: "Public", description: "テナントの誰でも参加できる", Icon: Globe },
  private: { label: "Private", description: "オーナーか管理者が招待した人だけが入れる", Icon: Lock },
  connect: { label: "Connect", description: "ほかのテナントの人と一緒に使う。招待した人だけが入れる", Icon: Handshake },
};

export function RoomKindBadge({ kind }: { kind: RoomKind }) {
  const { label, description, Icon } = ROOM_KINDS[kind];
  return (
    <Badge tone="neutral" title={description}>
      <Icon aria-hidden="true" className="size-3.5" />
      {label}
    </Badge>
  );
}
