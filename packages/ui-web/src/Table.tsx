import type { ComponentProps } from "react";

import { cx } from "./cx.ts";

// 表。幅が足りなければ横に流す
export function Table({ className, ...props }: ComponentProps<"table">) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className={cx("w-full border-collapse text-sm", className)} {...props} />
    </div>
  );
}

interface CellOptions {
  // end: 数値(右寄せ、桁をそろえる)
  align?: "start" | "end";
  // 中身の幅だけにする(操作の列)
  shrink?: boolean;
}

function cellClass({ align = "start", shrink }: CellOptions): string {
  return cx(
    "px-3 py-2",
    align === "end" ? "text-right tabular-nums" : "text-left",
    shrink && "w-px whitespace-nowrap",
  );
}

export function Th({ align, shrink, className, ...props }: Omit<ComponentProps<"th">, "align"> & CellOptions) {
  return (
    <th
      className={cx(cellClass({ align, shrink }), "border-b border-border bg-surface-muted font-medium text-fg-muted", className)}
      {...props}
    />
  );
}

export function Td({ align, shrink, className, ...props }: Omit<ComponentProps<"td">, "align"> & CellOptions) {
  return (
    <td
      className={cx(cellClass({ align, shrink }), "border-b border-border align-middle in-[tr:last-child]:border-b-0", className)}
      {...props}
    />
  );
}
