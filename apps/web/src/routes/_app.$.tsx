import { Link } from "react-router";

export default function NotFound() {
  return (
    <section>
      <h1>ページが見つかりません</h1>
      <Link to="/">ルームの一覧に戻る</Link>
    </section>
  );
}
