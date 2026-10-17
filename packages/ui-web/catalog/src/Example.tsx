import type { ReactNode } from "react";

import { cx, Table, Td, Th } from "@voice-intercom/ui-web";

// 見本帳の1節(トークン1種、部品1つ)。id は左のナビのリンク先
export function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="grid scroll-mt-6 gap-5">
      <div className="grid gap-1 border-b border-border pb-3">
        <h2 id={`${id}-title`} className="text-xl">
          {title}
        </h2>
        {description && <p className="text-sm text-fg-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

// 見本1つ。上に実物、下に書き方
export function Example({
  title,
  code,
  previewClassName,
  children,
}: {
  title?: ReactNode;
  code?: string;
  // 実物を置く面の並べ方。渡すと既定(横に並べて折り返す)に替わる
  previewClassName?: string;
  children: ReactNode;
}) {
  return (
    <figure className="overflow-hidden rounded-lg border border-border bg-surface">
      {title && (
        <figcaption className="border-b border-border px-4 py-2 text-xs font-medium text-fg-muted">{title}</figcaption>
      )}
      <div className={cx("bg-canvas p-6", previewClassName ?? "flex flex-wrap items-center gap-3")}>{children}</div>
      {code && (
        <pre className="overflow-x-auto border-t border-border bg-surface-muted px-4 py-3 text-xs leading-relaxed">
          <code className="rounded-none bg-transparent p-0">{code}</code>
        </pre>
      )}
    </figure>
  );
}

export interface PropRow {
  name: string;
  type: string;
  defaultValue?: string;
  description: string;
}

// props の一覧
export function PropsTable({ rows }: { rows: PropRow[] }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th shrink>props</Th>
          <Th>型</Th>
          <Th shrink>既定</Th>
          <Th>説明</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.name}>
            <Td shrink>
              <code>{row.name}</code>
            </Td>
            <Td className="font-mono text-xs">{row.type}</Td>
            <Td shrink className="font-mono text-xs text-fg-muted">
              {row.defaultValue ?? "—"}
            </Td>
            <Td>{row.description}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
