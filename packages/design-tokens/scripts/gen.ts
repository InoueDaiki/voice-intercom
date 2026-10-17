// src/tokens.ts から generated/ の4つを作る(mise run gen:tokens)。
// - theme.css: Tailwind v4 のテーマ(Web。React Native の Uniwind でも読める形にしている)
// - native.ts: React Native で JS から色を使うときの値(HEX)
// - TOKENS.md: トークンの一覧(人と AI が名前を選ぶときに読む)
// - cognito-branding.json: Cognito のマネージドログインのブランディング(infra/modules/cognito が読む)
// 依存なしで Node の型の除去(node scripts/gen.ts)だけで動かす
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { cognitoBranding } from "../src/cognito.ts";
import { toCss, toHex } from "../src/color.ts";
import { colors, fontFamily, radius, type ColorToken } from "../src/tokens.ts";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "generated");
const header = "生成物。packages/design-tokens/src/tokens.ts から `mise run gen:tokens` で作る。手で編集しない";
const entries = Object.entries(colors) as [string, ColorToken][];

function themeCss(): string {
  const light = entries.map(([name, t]) => `  --color-${name}: ${toCss(t.light)};`);
  const dark = entries.map(([name, t]) => `      --color-${name}: ${toCss(t.dark)};`);
  const radii = Object.entries(radius).map(([name, rem]) => `  --radius-${name}: ${rem}rem;`);
  const fonts = Object.entries(fontFamily).map(([name, v]) => `  --font-${name}: ${v};`);
  return `/* ${header} */

/* Tailwind の既定の色と角丸は消し、ここにあるものだけを使えるようにする */
@theme {
  --color-*: initial;
${light.join("\n")}

  --radius-*: initial;
${radii.join("\n")}

${fonts.join("\n")}
}

/* 暗い配色。dark は既定で prefers-color-scheme: dark */
@layer theme {
  :root {
    @variant dark {
${dark.join("\n")}
    }
  }
}
`;
}

function nativeTs(): string {
  const scheme = (key: "light" | "dark") =>
    entries.map(([name, t]) => `    ${JSON.stringify(name)}: ${JSON.stringify(toHex(t[key]))},`).join("\n");
  const radii = Object.entries(radius)
    .map(([name, rem]) => `  ${name}: ${rem * 16},`)
    .join("\n");
  return `// ${header}
// React Native は OKLCH を解釈できないので HEX にしてある。角丸は px(1rem = 16px)

export const colors = {
  light: {
${scheme("light")}
  },
  dark: {
${scheme("dark")}
  },
} as const;

export type ColorName = keyof (typeof colors)["light"];

export const radius = {
${radii}
} as const;
`;
}

function tokensMd(): string {
  const rows = entries.map(
    ([name, t]) => `| \`${name}\` | ${t.usage} | \`${toHex(t.light)}\` | \`${toHex(t.dark)}\` |`,
  );
  const radii = Object.entries(radius).map(([name, rem]) => `| \`rounded-${name}\` | ${rem * 16}px |`);
  return `<!-- ${header} -->

# デザイントークン

色は役割の名前で選ぶ。Tailwind のクラスでは \`bg-<名前>\`、\`text-<名前>\`、\`border-<名前>\` のように書く(例: \`bg-surface text-fg border-border\`)。明暗は OS の設定で自動で切り替わるので、\`dark:\` は書かない。

## 色

| 名前 | 使う場面 | 明 | 暗 |
| --- | --- | --- | --- |
${rows.join("\n")}

## 角丸

| クラス | 大きさ |
| --- | --- |
${radii.join("\n")}

\`rounded-full\` も使える。余白と文字の大きさは Tailwind の既定(\`p-4\`、\`text-sm\` など)を使う。
`;
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "theme.css"), themeCss());
writeFileSync(join(outDir, "native.ts"), nativeTs());
writeFileSync(join(outDir, "TOKENS.md"), tokensMd());
// JSON にはコメントを書けないので、生成物であることは README に書く
writeFileSync(join(outDir, "cognito-branding.json"), `${JSON.stringify(cognitoBranding(), null, 2)}\n`);
