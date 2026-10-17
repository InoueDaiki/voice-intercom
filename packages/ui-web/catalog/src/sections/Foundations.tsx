import { contrastRatio, toHex } from "@voice-intercom/design-tokens/color";
import { colors, contrastPairs, radius, type ColorName } from "@voice-intercom/design-tokens/tokens";
import { Badge, cx, Table, Td, Th } from "@voice-intercom/ui-web";

import { Example, Section } from "../Example.tsx";

// Tailwind はクラス名を文字列のまま探すので、組み立てずに全部書く。
// Record<ColorName, …> なので、トークンを足すと型の検査がここの書き足しを求める
const bgClasses: Record<ColorName, string> = {
  canvas: "bg-canvas",
  surface: "bg-surface",
  "surface-muted": "bg-surface-muted",
  "surface-strong": "bg-surface-strong",
  fg: "bg-fg",
  "fg-muted": "bg-fg-muted",
  border: "bg-border",
  "border-strong": "bg-border-strong",
  primary: "bg-primary",
  "primary-hover": "bg-primary-hover",
  "on-primary": "bg-on-primary",
  "primary-soft": "bg-primary-soft",
  "primary-fg": "bg-primary-fg",
  key: "bg-key",
  "on-key": "bg-on-key",
  "key-hover": "bg-key-hover",
  danger: "bg-danger",
  "on-danger": "bg-on-danger",
  "danger-soft": "bg-danger-soft",
  "danger-fg": "bg-danger-fg",
  "warning-soft": "bg-warning-soft",
  "warning-fg": "bg-warning-fg",
  "success-soft": "bg-success-soft",
  "success-fg": "bg-success-fg",
  live: "bg-live",
  "on-live": "bg-on-live",
  rx: "bg-rx",
  "rx-soft": "bg-rx-soft",
  "rx-fg": "bg-rx-fg",
  overlay: "bg-overlay",
  "on-overlay": "bg-on-overlay",
};

const textClasses: Record<ColorName, string> = {
  canvas: "text-canvas",
  surface: "text-surface",
  "surface-muted": "text-surface-muted",
  "surface-strong": "text-surface-strong",
  fg: "text-fg",
  "fg-muted": "text-fg-muted",
  border: "text-border",
  "border-strong": "text-border-strong",
  primary: "text-primary",
  "primary-hover": "text-primary-hover",
  "on-primary": "text-on-primary",
  "primary-soft": "text-primary-soft",
  "primary-fg": "text-primary-fg",
  key: "text-key",
  "on-key": "text-on-key",
  "key-hover": "text-key-hover",
  danger: "text-danger",
  "on-danger": "text-on-danger",
  "danger-soft": "text-danger-soft",
  "danger-fg": "text-danger-fg",
  "warning-soft": "text-warning-soft",
  "warning-fg": "text-warning-fg",
  "success-soft": "text-success-soft",
  "success-fg": "text-success-fg",
  live: "text-live",
  "on-live": "text-on-live",
  rx: "text-rx",
  "rx-soft": "text-rx-soft",
  "rx-fg": "text-rx-fg",
  overlay: "text-overlay",
  "on-overlay": "text-on-overlay",
};

// 色のまとまり(tokens.ts の並びと見出しに合わせる)。ここにない色は「その他」に出す
const colorGroups: { title: string; names: ColorName[] }[] = [
  { title: "地と面", names: ["canvas", "surface", "surface-muted", "surface-strong"] },
  { title: "文字と線", names: ["fg", "fg-muted", "border", "border-strong"] },
  { title: "主な操作(点灯したキー)", names: ["primary", "primary-hover", "on-primary", "primary-soft", "primary-fg"] },
  { title: "大きなキー", names: ["key", "on-key", "key-hover"] },
  { title: "危険・注意・成功", names: ["danger", "on-danger", "danger-soft", "danger-fg", "warning-soft", "warning-fg", "success-soft", "success-fg"] },
  { title: "送話(TX)と受信(RX)", names: ["live", "on-live", "rx", "rx-soft", "rx-fg"] },
  { title: "重ねる帯", names: ["overlay", "on-overlay"] },
];

function allColorGroups() {
  const listed = new Set(colorGroups.flatMap((g) => g.names));
  const rest = (Object.keys(colors) as ColorName[]).filter((name) => !listed.has(name));
  return rest.length > 0 ? [...colorGroups, { title: "その他", names: rest }] : colorGroups;
}

export function ColorsSection() {
  return (
    <Section
      id="colors"
      title="色"
      description="役割の名前で選ぶ。bg-<名前>・text-<名前>・border-<名前> のクラスで書く。色見本は今の明暗で、値は明と暗の両方を載せる。"
    >
      {allColorGroups().map((group) => (
        <div key={group.title} className="grid gap-3">
          <h3 className="text-sm font-bold">{group.title}</h3>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-3">
            {group.names.map((name) => (
              <div key={name} className="overflow-hidden rounded-lg border border-border bg-surface">
                {/* 半透明の色(overlay)も見えるよう、市松ではなく地の上に置く */}
                <div className={cx("h-14 border-b border-border", bgClasses[name])} />
                <div className="grid gap-1.5 p-3">
                  <code className="justify-self-start text-sm font-medium">{name}</code>
                  <p className="text-xs leading-relaxed text-fg-muted">{colors[name].usage}</p>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-2 font-mono text-xs text-fg-muted">
                    <dt>明</dt>
                    <dd>{toHex(colors[name].light)}</dd>
                    <dt>暗</dt>
                    <dd>{toHex(colors[name].dark)}</dd>
                  </dl>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </Section>
  );
}

function Ratio({ value, min }: { value: number; min: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      {value.toFixed(2)}
      {value < min && <Badge tone="danger">不足</Badge>}
    </span>
  );
}

export function ContrastSection() {
  return (
    <Section
      id="contrast"
      title="コントラスト"
      description="文字と地の組み合わせと、WCAG 2 のコントラスト比(design-tokens のテストで確かめている組)。基準は本文 4.5、大きい文字と部品の線 3。"
    >
      <Table>
        <thead>
          <tr>
            <Th shrink>見本</Th>
            <Th>文字・線</Th>
            <Th>地</Th>
            <Th align="end">明</Th>
            <Th align="end">暗</Th>
            <Th align="end">基準</Th>
          </tr>
        </thead>
        <tbody>
          {contrastPairs.map(({ fg, bg, min }) => (
            // 同じ組を、文字と線の2つの基準で測ることがある
            <tr key={`${fg}/${bg}/${min}`}>
              <Td shrink>
                <span
                  className={cx(
                    "inline-flex h-8 w-20 items-center justify-center rounded-sm border border-border text-sm font-medium",
                    bgClasses[bg],
                    textClasses[fg],
                  )}
                >
                  Aa あ
                </span>
              </Td>
              <Td>
                <code>{fg}</code>
              </Td>
              <Td>
                <code>{bg}</code>
              </Td>
              <Td align="end">
                <Ratio value={contrastRatio(colors[fg].light, colors[bg].light)} min={min} />
              </Td>
              <Td align="end">
                <Ratio value={contrastRatio(colors[fg].dark, colors[bg].dark)} min={min} />
              </Td>
              <Td align="end">{min}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Section>
  );
}

const radiusRows: { name: string; className: string; value: string; usage: string }[] = [
  { name: "rounded-sm", className: "rounded-sm", value: `${radius.sm}rem`, usage: "札とコード" },
  { name: "rounded-md", className: "rounded-md", value: `${radius.md}rem`, usage: "ボタンと入力欄" },
  { name: "rounded-lg", className: "rounded-lg", value: `${radius.lg}rem`, usage: "面と表" },
  { name: "rounded-xl", className: "rounded-xl", value: `${radius.xl}rem`, usage: "PTT のキー" },
  { name: "rounded-full", className: "rounded-full", value: "—", usage: "表示灯" },
];

export function RadiusSection() {
  return (
    <Section id="radius" title="角丸" description="大きさで役割を分ける。">
      <Example>
        {radiusRows.map((row) => (
          <div key={row.name} className="grid justify-items-center gap-2 text-center">
            <div className={cx("size-20 border-2 border-border-strong bg-surface", row.className)} />
            <code className="text-xs">{row.name}</code>
            <span className="text-xs text-fg-muted">
              {row.value}・{row.usage}
            </span>
          </div>
        ))}
      </Example>
    </Section>
  );
}

export function TypeSection() {
  return (
    <Section
      id="type"
      title="文字"
      description="書体は IBM Plex Sans JP の1つ。大きさは Tailwind の既定(text-2xl・text-base・text-sm・text-xs)を使う。数字は幅をそろえてある。"
    >
      <Example previewClassName="grid gap-4 justify-items-start">
        <h1>画面の題(h1・text-2xl・太字)</h1>
        <h2>節の見出し(h2・text-base・太字)</h2>
        <p className="text-base">本文(text-base)。押している間だけ話し、離すと止まります。</p>
        <p className="text-sm">小さい本文(text-sm)。表・知らせ・ボタンの文字。</p>
        <p className="text-xs text-fg-muted">補足(text-xs・text-fg-muted)。時刻、件数、入力の説明。</p>
        <p className="flex flex-wrap gap-4 text-sm">
          <span className="font-normal">400 標準</span>
          <span className="font-medium">500 中太</span>
          <span className="font-bold">700 太字</span>
        </p>
        <p className="text-sm">
          文の中の<a href="#type">リンク</a>と<code>コード</code>。
        </p>
        <p className="font-mono text-sm">等幅(font-mono)0123456789</p>
        <p className="text-2xl font-bold">12:05:09 / 11:11:11</p>
      </Example>
    </Section>
  );
}
