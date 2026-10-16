// 表示の整形

export function formatTime(d: Date): string {
  if (Number.isNaN(d.getTime())) {
    return "";
  }
  // 今日でなければ日付も出す(古い履歴を読み足したとき)
  const sameDay = d.toDateString() === new Date().toDateString();
  return d.toLocaleString("ja-JP", {
    ...(sameDay ? {} : { month: "numeric", day: "numeric" }),
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatBytes(n: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i === 0 ? v : v.toFixed(1)} ${units[i]}`;
}

// 動画の長さ(分:秒。秒は切り上げ)
export function formatDuration(ms: number): string {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
