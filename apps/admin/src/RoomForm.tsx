import { Alert, Button, Card, Field, Input } from "@voice-intercom/ui-web";
import { useState, type FormEvent } from "react";

import { MemberEditor } from "./MemberEditor.tsx";
import { ROOM_NAME_MAX, validateRoomId, validateRoomName } from "./rooms.ts";

export interface RoomFormValues {
  room_id: string;
  name: string;
  member_ids: string[];
}

interface Props {
  initial: RoomFormValues;
  // 作成のときだけ ID を入力できる(ID は後から変えられない)
  editableId: boolean;
  submitLabel: string;
  pending: boolean;
  // サーバーが返したエラーの文
  serverError?: string;
  onSubmit: (values: RoomFormValues) => void;
}

// ルームの作成と編集で共通のフォーム
export function RoomForm({ initial, editableId, submitLabel, pending, serverError, onSubmit }: Props) {
  const [values, setValues] = useState(initial);
  // 一度送ろうとするまでは、入力中に検査の結果を出さない
  const [touched, setTouched] = useState(false);

  const idError = editableId ? validateRoomId(values.room_id) : undefined;
  const nameError = validateRoomName(values.name);
  const changed =
    values.room_id !== initial.room_id ||
    values.name !== initial.name ||
    values.member_ids.join("\n") !== initial.member_ids.join("\n");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (idError || nameError) {
      return;
    }
    onSubmit({ ...values, name: values.name.trim() });
  };

  return (
    <form className="grid max-w-2xl gap-4" onSubmit={submit} noValidate>
      <Card className="grid gap-4">
        {editableId && (
          <Field
            label="ルーム ID"
            hint="半角英数字と - _、64文字以内。作成した後は変えられません。"
            error={touched ? idError : undefined}
          >
            <Input
              value={values.room_id}
              onChange={(e) => setValues({ ...values, room_id: e.target.value })}
              maxLength={64}
              autoComplete="off"
              disabled={pending}
            />
          </Field>
        )}
        <Field
          label="名前"
          hint={`${[...values.name].length} / ${ROOM_NAME_MAX}文字`}
          error={touched ? nameError : undefined}
        >
          <Input value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} disabled={pending} />
        </Field>
      </Card>
      <MemberEditor
        memberIds={values.member_ids}
        onChange={(member_ids) => setValues({ ...values, member_ids })}
        disabled={pending}
      />
      {serverError && <Alert tone="danger">{serverError}</Alert>}
      <div>
        {/* 編集では、何も変えていなければ送れないようにする */}
        <Button type="submit" variant="primary" disabled={pending || (!editableId && !changed)}>
          {pending ? "送信中…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
