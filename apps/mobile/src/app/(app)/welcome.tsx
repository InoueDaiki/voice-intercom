import { useMe } from "@voice-intercom/client-react";
import { PageHeader } from "@voice-intercom/ui-native";

import { Page } from "../../components/Page.tsx";
import { ProfileForm } from "../../components/ProfileForm.tsx";

// 初めてログインした人の、プロフィールの登録。登録するとルームの一覧に移る(レイアウトが切り替える)
export default function Welcome() {
  const me = useMe();
  return (
    <Page>
      <PageHeader title="プロフィール" description="ルームに入る前に、表示名と言語を登録してください。" />
      <ProfileForm me={me.data ?? null} />
    </Page>
  );
}
