import { LANGUAGE_LABELS, LANGUAGES, type Language, type User } from "@voice-intercom/client-core";
import { displayNameError, errorMessage, usePutMe } from "@voice-intercom/client-react";
import { Alert, Button, Card, Field, Input, Select } from "@voice-intercom/ui-native";
import { useState } from "react";
import { View } from "react-native";

const languageOptions = LANGUAGES.map((l) => ({ value: l, label: LANGUAGE_LABELS[l] }));

// 表示名と言語。言語は話す言語で、翻訳音声と訳の字幕もこの言語で受け取る。
// 登録(初めて)と変更で使う
export function ProfileForm({ me, onSaved }: { me: User | null; onSaved?: () => void }) {
  const put = usePutMe();
  const registered = me !== null;
  const [displayName, setDisplayName] = useState(me?.display_name ?? "");
  const [language, setLanguage] = useState<Language>(me?.language ?? "ja");
  const [saved, setSaved] = useState(false);

  const trimmed = displayName.trim();
  const invalid = displayNameError(trimmed);

  const submit = () => {
    if (invalid) {
      return;
    }
    setSaved(false);
    put.mutate(
      { displayName: trimmed, language },
      {
        onSuccess: () => {
          setSaved(true);
          onSaved?.();
        },
      },
    );
  };

  return (
    <View className="gap-4">
      <Card className="gap-4">
        <Field label="表示名" error={displayName !== "" ? invalid : undefined}>
          <Input
            value={displayName}
            onChangeText={setDisplayName}
            autoComplete="nickname"
            textContentType="nickname"
            returnKeyType="done"
            onSubmitEditing={submit}
          />
        </Field>
        <Field label="言語" hint="話す言語。翻訳音声と字幕もこの言語で受け取ります。">
          <Select value={language} options={languageOptions} onChange={setLanguage} />
        </Field>
      </Card>
      {put.isError && <Alert tone="danger">保存できません: {errorMessage(put.error)}</Alert>}
      {saved && registered && <Alert tone="success">保存しました。</Alert>}
      <Button variant="primary" className="self-start" disabled={put.isPending || invalid !== undefined} onPress={submit}>
        {registered ? "保存する" : "登録する"}
      </Button>
    </View>
  );
}
