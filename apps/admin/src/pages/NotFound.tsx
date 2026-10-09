import { Link } from "react-router";

export function NotFound() {
  return (
    <section>
      <h1>ページが見つかりません</h1>
      <Link to="/">ホームに戻る</Link>
    </section>
  );
}
