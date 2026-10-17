import { LANGUAGE_LABELS, LANGUAGES, type Language } from "@voice-intercom/client-core";
import { Alert, Button, Card, Field, Input, PageHeader, Select } from "@voice-intercom/ui-web";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";

import { errorMessage, useMe, usePutMe } from "../queries.ts";

// services/api の PutUserRequest と同じ上限
const DISPLAY_NAME_MAX = 50;

// 表示名と言語。言語は話す言語で、翻訳音声と訳の字幕もこの言語で受け取る
export default function Profile() {
  const me = useMe();
  const put = usePutMe();
  const navigate = useNavigate();
  const registered = me.data != null;
  const [displayName, setDisplayName] = useState(me.data?.display_name ?? "");
  const [language, setLanguage] = useState<Language>(me.data?.language ?? "ja");
  const [saved, setSaved] = useState(false);

  const trimmed = displayName.trim();
  const invalid =
    trimmed === ""
      ? "表示名を入力してください"
      : [...trimmed].length > DISPLAY_NAME_MAX
        ? `表示名は${DISPLAY_NAME_MAX}文字以内にしてください`
        : undefined;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (invalid) {
      return;
    }
    setSaved(false);
    put.mutate(
      { displayName: trimmed, language },
      {
        onSuccess: () => {
          setSaved(true);
          if (!registered) {
            void navigate("/", { replace: true });
          }
        },
      },
    );
  };

  return (
    <section className="mx-auto max-w-lg px-4 py-8 sm:px-6">
      <PageHeader
        title="プロフィール"
        description={registered ? undefined : "ルームに入る前に、表示名と言語を登録してください。"}
      />
      <form className="grid gap-4" onSubmit={onSubmit}>
        <Card className="grid gap-4">
          <Field label="表示名" error={displayName !== "" ? invalid : undefined}>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="nickname" />
          </Field>
          <Field label="言語" hint="話す言語。翻訳音声と字幕もこの言語で受け取ります。">
            <Select value={language} onChange={(e) => setLanguage(e.target.value as Language)}>
              {LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {LANGUAGE_LABELS[l]}
                </option>
              ))}
            </Select>
          </Field>
        </Card>
        {put.isError && <Alert tone="danger">保存できません: {errorMessage(put.error)}</Alert>}
        {saved && <Alert tone="success">保存しました。</Alert>}
        <div>
          <Button type="submit" variant="primary" disabled={put.isPending || invalid !== undefined}>
            {registered ? "保存する" : "登録する"}
          </Button>
        </div>
      </form>
    </section>
  );
}
