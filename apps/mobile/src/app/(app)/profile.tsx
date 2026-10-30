import { useMe } from "@voice-intercom/client-react";
import { Button, Card, PageHeader, Text } from "@voice-intercom/ui-native";
import { View } from "react-native";

import { useAuth } from "../../auth.ts";
import { Page } from "../../components/Page.tsx";
import { ProfileForm } from "../../components/ProfileForm.tsx";

// 表示名と言語の変更と、ログアウト
export default function Profile() {
  const me = useMe();
  const auth = useAuth();
  const user = auth.state.status === "signedIn" ? auth.state.user : undefined;
  return (
    <Page>
      <View>
        <PageHeader title="プロフィール" />
        {me.data && <ProfileForm me={me.data} />}
      </View>
      <Card className="flex-row flex-wrap items-center justify-between gap-3">
        <Text className="min-w-0 flex-1 text-sm text-fg-muted" numberOfLines={1}>
          {user?.email ?? user?.sub}
        </Text>
        <Button onPress={() => void auth.signOut()}>ログアウト</Button>
      </Card>
    </Page>
  );
}
