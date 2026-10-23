import { PageHeader } from "@voice-intercom/ui-web";
import { Link } from "react-router";

export default function NotFound() {
  return (
    <section className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <PageHeader title="ページが見つかりません" />
      <Link to="/">ルームの一覧に戻る</Link>
    </section>
  );
}
