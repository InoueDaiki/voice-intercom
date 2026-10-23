import { PageHeader } from "@voice-intercom/ui-web";
import { Link, useNavigate } from "react-router";

import { useCreateRoom } from "../queries.ts";
import { RoomForm } from "../RoomForm.tsx";
import { errorMessage } from "../rooms.ts";

// 作った管理者がオーナーになる。メンバーは作った後のルームの画面で足す。
// Connect は Connect の画面から、相手のテナントに申請して作る
export default function RoomCreate() {
  const navigate = useNavigate();
  const create = useCreateRoom();

  return (
    <section>
      <PageHeader
        title="ルームを作る"
        back={<Link to="/rooms">← ルームの一覧</Link>}
        description="作った人がオーナーになります。メンバーは作った後に足せます。"
      />
      <RoomForm
        initial={{ name: "", kind: "private" }}
        creating
        submitLabel="作成"
        pending={create.isPending}
        serverError={create.error ? errorMessage(create.error) : undefined}
        onSubmit={({ name, kind }) =>
          create.mutate(
            { name, kind: kind === "public" ? "public" : "private", member_ids: [] },
            { onSuccess: (room) => void navigate(`/rooms/${encodeURIComponent(room.room_id)}`) },
          )
        }
      />
    </section>
  );
}
