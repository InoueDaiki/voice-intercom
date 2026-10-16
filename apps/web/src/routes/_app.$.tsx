import { PageHeader } from "@voice-intercom/ui-web";
import { Link } from "react-router";

export default function NotFound() {
  return (
    <section>
      <PageHeader title="ページが見つかりません" />
      <Link to="/">ルームの一覧に戻る</Link>
    </section>
  );
}
