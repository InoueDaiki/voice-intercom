import { Layout } from "../Layout.tsx";
import { RequireAdmin } from "../RequireAdmin.tsx";

// パスを持たないレイアウト。/callback 以外の画面は、admin グループでログインしていないと見せない
export default function AdminLayout() {
  return (
    <RequireAdmin>
      <Layout />
    </RequireAdmin>
  );
}
