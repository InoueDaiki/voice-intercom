import { Link, useNavigate } from "react-router";

import { ApiError } from "../adminApi.ts";
import { useCreateRoom } from "../queries.ts";
import { RoomForm } from "../RoomForm.tsx";
import { errorMessage } from "../rooms.ts";

export function RoomCreate() {
  const navigate = useNavigate();
  const create = useCreateRoom();

  let serverError: string | undefined;
  if (create.error) {
    serverError =
      create.error instanceof ApiError && create.error.status === 409
        ? `ルーム ID「${create.variables?.room_id}」は既に使われています。別の ID にしてください。`
        : errorMessage(create.error);
  }

  return (
    <section>
      <p>
        <Link to="/rooms">← ルームの一覧</Link>
      </p>
      <h1>ルームを作る</h1>
      <RoomForm
        initial={{ room_id: "", name: "", member_ids: [] }}
        editableId
        submitLabel="作成"
        pending={create.isPending}
        serverError={serverError}
        onSubmit={(values) =>
          create.mutate(values, {
            onSuccess: (room) => void navigate(`/rooms/${encodeURIComponent(room.room_id)}`),
          })
        }
      />
    </section>
  );
}
