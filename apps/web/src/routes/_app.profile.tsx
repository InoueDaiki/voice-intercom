import { LANGUAGE_LABELS, LANGUAGES, type Language } from "@voice-intercom/client-core";
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
    <section>
      <h1>プロフィール</h1>
      {!registered && <p>ルームに入る前に、表示名と言語を登録してください。</p>}
      <form className="form" onSubmit={onSubmit}>
        <label className="field">
          表示名
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            aria-invalid={displayName !== "" && invalid !== undefined}
            autoComplete="nickname"
          />
        </label>
        <label className="field">
          言語(話す言語。翻訳音声と字幕もこの言語で受け取る)
          <select value={language} onChange={(e) => setLanguage(e.target.value as Language)}>
            {LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {LANGUAGE_LABELS[l]}
              </option>
            ))}
          </select>
        </label>
        {displayName !== "" && invalid && <p className="error">{invalid}</p>}
        {put.isError && (
          <p className="error" role="alert">
            保存できません: {errorMessage(put.error)}
          </p>
        )}
        {saved && <p className="success">保存しました。</p>}
        <div className="row">
          <button type="submit" disabled={put.isPending || invalid !== undefined}>
            {registered ? "保存する" : "登録する"}
          </button>
        </div>
      </form>
    </section>
  );
}
