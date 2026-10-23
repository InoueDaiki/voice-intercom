import { cx } from "./cx.ts";

// 画面の題の上に置く、一つ上の画面へ戻るリンクの見た目。
// 文の中のリンクではなくナビゲーションなので、下線を付けず、‹ を添えて薄く出す。
// ルーターの <Link> に付けて使う: <Link to="/rooms" className={backLinkClass}><BackIcon />ルームの一覧</Link>
export const backLinkClass =
  "inline-flex w-fit items-center gap-0.5 rounded-sm text-sm text-fg-muted no-underline hover:text-fg hover:no-underline";

// 戻るリンクの ‹。アプリが Lucide を持っていなくても使えるよう、ここで描く
export function BackIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cx("size-4 shrink-0", className)}
    >
      <path d="M10 4l-4 4 4 4" />
    </svg>
  );
}
