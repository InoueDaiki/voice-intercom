import { Alert, Button, Card, ChoiceGroup, Field, Input } from "@voice-intercom/ui-web";
import { useState, type FormEvent } from "react";

import type { RoomKind } from "./adminApi.ts";
import { ROOM_KIND_LABELS, ROOM_NAME_MAX, validateRoomName } from "./rooms.ts";

export interface RoomFormValues {
  name: string;
  // Connect は申請(Connect の画面)でしか作れず、種別も変えられない
  kind: RoomKind;
}

interface Props {
  initial: RoomFormValues;
  submitLabel: string;
  pending: boolean;
  // 作成のときは、何も変えていなくても送れる
  creating?: boolean;
  // サーバーが返したエラーの文
  serverError?: string;
  onSubmit: (values: RoomFormValues) => void;
}

// ルームの作成と編集で共通の、名前と種別のフォーム
export function RoomForm({ initial, submitLabel, pending, creating = false, serverError, onSubmit }: Props) {
  const [values, setValues] = useState(initial);
  // 一度送ろうとするまでは、入力中に検査の結果を出さない
  const [touched, setTouched] = useState(false);
  // 送った後に入力を直したら、前の送信のエラー(使われている ID など)は直した内容に当てはまらないので消す
  const [editedAfterSubmit, setEditedAfterSubmit] = useState(false);
  const edit = (next: RoomFormValues) => {
    setValues(next);
    setEditedAfterSubmit(true);
  };

  const nameError = validateRoomName(values.name);
  const changed = values.name !== initial.name || values.kind !== initial.kind;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setEditedAfterSubmit(false);
    if (nameError) {
      return;
    }
    onSubmit({ ...values, name: values.name.trim() });
  };

  return (
    <form className="grid gap-4" onSubmit={submit} noValidate>
      <Card className="grid gap-4">
        <Field
          label="名前"
          hint={`${[...values.name].length} / ${ROOM_NAME_MAX}文字`}
          error={touched ? nameError : undefined}
        >
          <Input value={values.name} onChange={(e) => edit({ ...values, name: e.target.value })} disabled={pending} />
        </Field>
        {values.kind === "connect" ? (
          <p className="text-sm">
            <span className="font-medium">種別: Connect</span>
            <span className="text-fg-muted">(変えられません。{ROOM_KIND_LABELS.connect.description})</span>
          </p>
        ) : (
          <ChoiceGroup
            legend="種別"
            name="kind"
            value={values.kind}
            onChange={(kind) => edit({ ...values, kind })}
            disabled={pending}
            options={(["private", "public"] as const).map((k) => ({ value: k, ...ROOM_KIND_LABELS[k] }))}
          />
        )}
      </Card>
      {serverError && !editedAfterSubmit && <Alert tone="danger">{serverError}</Alert>}
      <div>
        {/* 編集では、何も変えていなければ送れないようにする */}
        <Button type="submit" variant="primary" disabled={pending || (!creating && !changed)}>
          {pending ? "送信中…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
