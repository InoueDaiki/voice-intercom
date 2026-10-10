import { useId, useState, type FormEvent } from "react";

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
  const idInput = useId();
  const nameInput = useId();

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
    <form className="form" onSubmit={submit} noValidate>
      {editableId && (
        <div className="field">
          <label htmlFor={idInput}>ルーム ID</label>
          <input
            id={idInput}
            value={values.room_id}
            onChange={(e) => setValues({ ...values, room_id: e.target.value })}
            maxLength={64}
            autoComplete="off"
            aria-invalid={touched && !!idError}
            disabled={pending}
          />
          <small className="muted">半角英数字と - _、64文字以内。作成した後は変えられません。</small>
          {touched && idError && <small className="error">{idError}</small>}
        </div>
      )}
      <div className="field">
        <label htmlFor={nameInput}>名前</label>
        <input
          id={nameInput}
          value={values.name}
          onChange={(e) => setValues({ ...values, name: e.target.value })}
          aria-invalid={touched && !!nameError}
          disabled={pending}
        />
        <small className="muted">
          {[...values.name].length} / {ROOM_NAME_MAX}文字
        </small>
        {touched && nameError && <small className="error">{nameError}</small>}
      </div>
      <MemberEditor
        memberIds={values.member_ids}
        onChange={(member_ids) => setValues({ ...values, member_ids })}
        disabled={pending}
      />
      {serverError && (
        <p className="error" role="alert">
          {serverError}
        </p>
      )}
      <div className="row">
        {/* 編集では、何も変えていなければ送れないようにする */}
        <button type="submit" disabled={pending || (!editableId && !changed)}>
          {pending ? "送信中…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
