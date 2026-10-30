// ルームの種別の名前・説明・アイコン(一覧、ルームの画面、作成と設定の画面で使う)
import type { RoomKind } from "@voice-intercom/client-core";
import { ROOM_KIND_LABELS } from "@voice-intercom/client-react";
import { Badge } from "@voice-intercom/ui-web";
import { Globe, Handshake, Lock, type LucideIcon } from "lucide-react";

export const ROOM_KINDS: Record<RoomKind, { label: string; description: string; Icon: LucideIcon }> = {
  public: { ...ROOM_KIND_LABELS.public, Icon: Globe },
  private: { ...ROOM_KIND_LABELS.private, Icon: Lock },
  connect: { ...ROOM_KIND_LABELS.connect, Icon: Handshake },
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
