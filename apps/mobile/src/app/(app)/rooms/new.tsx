import { LANGUAGE_LABELS } from "@voice-intercom/client-core";
import { errorMessage, roomNameError, useCreateRoom, useUsers } from "@voice-intercom/client-react";
import { Alert, Button, Card, CheckboxList, ChoiceGroup, Field, Icon, Input, PageHeader, Text } from "@voice-intercom/ui-native";
import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { useAuth } from "../../../auth.ts";
import { Page } from "../../../components/Page.tsx";
import { ROOM_KINDS } from "../../../roomKinds.tsx";

// ルームを作る。作った人がオーナーになる。Connect はテナントの管理者が管理コンソールで申請する
export default function NewRoom() {
  const create = useCreateRoom();
  const users = useUsers();
  const router = useRouter();
  const auth = useAuth();
  const myIdentity = auth.state.status === "signedIn" ? auth.state.user.sub : undefined;
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"public" | "private">("private");
  const [memberIds, setMemberIds] = useState<string[]>([]);

  const trimmed = name.trim();
  const invalid = roomNameError(trimmed);
  // 名前の順に並べ、同じ名前の人を見分けられるよう話す言語を添える
  const others = (users.data ?? [])
    .filter((u) => u.user_id !== myIdentity)
    .sort((a, b) => a.display_name.localeCompare(b.display_name, "ja"))
    .map((u) => ({ value: u.user_id, label: u.display_name, description: LANGUAGE_LABELS[u.language] }));

  const submit = () => {
    if (invalid) {
      return;
    }
    create.mutate(
      { name: trimmed, kind, memberIds },
      { onSuccess: (room) => router.replace({ pathname: "/rooms/[roomId]", params: { roomId: room.room_id } }) },
    );
  };

  return (
    <Page>
      <View className="gap-4">
        <PageHeader
          title="ルームを作る"
          description="作った人がオーナーになります。オーナーはメンバーを招待でき、ほかの人をオーナーにもできます。"
        />
        <Card className="gap-4">
          <Field label="名前" error={name !== "" ? invalid : undefined}>
            <Input value={name} onChangeText={setName} returnKeyType="done" />
          </Field>
          <ChoiceGroup
            legend="種類"
            name="kind"
            value={kind}
            onChange={setKind}
            options={(["private", "public"] as const).map((k) => {
              const { label, description, Icon: KindIcon } = ROOM_KINDS[k];
              return { value: k, label, description, icon: <Icon icon={KindIcon} /> };
            })}
          />
          {users.isPending && <Text className="text-sm text-fg-muted">ユーザーを読み込み中…</Text>}
          {users.isError && <Text className="text-sm text-danger-fg">ユーザーを取得できません: {errorMessage(users.error)}</Text>}
          {users.isSuccess && (
            <CheckboxList
              legend="一緒に入れる人"
              hint="あとからでも招待できます。"
              options={others}
              value={memberIds}
              onChange={setMemberIds}
              selectedLabel={(n) => `${n}人を選んでいます`}
              emptyMessage="テナントにほかのユーザーはいません。"
              noMatchMessage={(q) => `「${q}」に当てはまる人はいません。`}
            />
          )}
        </Card>
        {create.isError && <Alert tone="danger">作れませんでした: {errorMessage(create.error)}</Alert>}
        <Button variant="primary" className="self-start" disabled={create.isPending || invalid !== undefined} onPress={submit}>
          作る
        </Button>
      </View>
    </Page>
  );
}
