// Cognito のマネージドログイン(ホストされたログイン画面)のブランディングの設定。
// トークンの色と角丸を、Cognito の settings の形に写す。部品の配色は ui-web の部品に揃える
// (主なボタンは Button の primary、ほかのボタンは secondary、入力欄は Field の Input)。
// settings の形は Cognito の UpdateManagedLoginBranding の例による。書かなかった項目は Cognito の既定のまま。
// 書体は変えられない(Cognito の書体のまま)。
import { toHex, type Oklch } from "./color.ts";
import { colors, radius, type ColorName } from "./tokens.ts";

type Mode = "light" | "dark";

// Cognito の色は "rrggbbaa"(# なし、不透明度つき)
export function cognitoColor(color: Oklch): string {
  const hex = toHex(color).slice(1);
  return hex.length === 6 ? `${hex}ff` : hex;
}

// 角丸は px(1rem = 16px)
const px = (rem: number) => rem * 16;

// 明暗の両方の値を、Cognito の lightMode / darkMode に分けて作る
function modes<T>(build: (c: (name: ColorName) => string) => T): { lightMode: T; darkMode: T } {
  const pick = (mode: Mode) => build((name) => cognitoColor(colors[name][mode]));
  return { lightMode: pick("light"), darkMode: pick("dark") };
}

export function cognitoBranding() {
  return {
    categories: {
      form: {
        displayGraphics: true,
        location: { horizontal: "CENTER", vertical: "CENTER" },
      },
      global: {
        // OS の設定で明暗を切り替える(アプリと同じ)
        colorSchemeMode: "DYNAMIC",
        pageHeader: { enabled: false },
        pageFooter: { enabled: false },
        spacingDensity: "REGULAR",
      },
    },
    componentClasses: {
      buttons: { borderRadius: px(radius.md) },
      divider: modes((c) => ({ borderColor: c("border") })),
      dropDown: {
        borderRadius: px(radius.md),
        ...modes((c) => ({
          defaults: { itemBackgroundColor: c("surface") },
          hover: {
            itemBackgroundColor: c("surface-muted"),
            itemBorderColor: c("border-strong"),
            itemTextColor: c("fg"),
          },
          match: { itemBackgroundColor: c("primary-soft"), itemTextColor: c("primary-fg") },
        })),
      },
      // フォーカスの輪は fg(琥珀は白い地の上で見えにくい)
      focusState: modes((c) => ({ borderColor: c("fg") })),
      idpButtons: { icons: { enabled: true } },
      input: {
        borderRadius: px(radius.md),
        ...modes((c) => ({
          defaults: { backgroundColor: c("surface"), borderColor: c("border-strong") },
          placeholderColor: c("fg-muted"),
        })),
      },
      inputDescription: modes((c) => ({ textColor: c("fg-muted") })),
      inputLabel: modes((c) => ({ textColor: c("fg") })),
      // リンクは文字の色を変えない(琥珀は主な操作のために取っておく)
      link: modes((c) => ({
        defaults: { textColor: c("fg") },
        hover: { textColor: c("fg-muted") },
      })),
      optionControls: modes((c) => ({
        defaults: { backgroundColor: c("surface"), borderColor: c("border-strong") },
        selected: { backgroundColor: c("primary"), foregroundColor: c("on-primary") },
      })),
      statusIndicator: modes((c) => ({
        error: { backgroundColor: c("danger-soft"), borderColor: c("danger"), indicatorColor: c("danger") },
        pending: { indicatorColor: c("fg-muted") },
        success: {
          backgroundColor: c("success-soft"),
          borderColor: c("success-fg"),
          indicatorColor: c("success-fg"),
        },
        warning: {
          backgroundColor: c("warning-soft"),
          borderColor: c("warning-fg"),
          indicatorColor: c("warning-fg"),
        },
      })),
    },
    components: {
      alert: {
        borderRadius: px(radius.md),
        ...modes((c) => ({ error: { backgroundColor: c("danger-soft"), borderColor: c("danger") } })),
      },
      form: {
        backgroundImage: { enabled: false },
        borderRadius: px(radius.lg),
        ...modes((c) => ({ backgroundColor: c("surface"), borderColor: c("border") })),
        logo: { enabled: false },
      },
      idpButton: {
        standard: modes((c) => ({
          defaults: { backgroundColor: c("surface"), borderColor: c("border-strong"), textColor: c("fg") },
          hover: { backgroundColor: c("surface-muted"), borderColor: c("border-strong"), textColor: c("fg") },
          active: { backgroundColor: c("surface-strong"), borderColor: c("border-strong"), textColor: c("fg") },
        })),
      },
      pageBackground: {
        image: { enabled: false },
        ...modes((c) => ({ color: c("canvas") })),
      },
      pageText: modes((c) => ({
        headingColor: c("fg"),
        bodyColor: c("fg"),
        descriptionColor: c("fg-muted"),
      })),
      primaryButton: modes((c) => ({
        defaults: { backgroundColor: c("primary"), textColor: c("on-primary") },
        hover: { backgroundColor: c("primary-hover"), textColor: c("on-primary") },
        active: { backgroundColor: c("primary-hover"), textColor: c("on-primary") },
        disabled: { backgroundColor: c("surface-muted"), borderColor: c("border") },
      })),
      secondaryButton: modes((c) => ({
        defaults: { backgroundColor: c("surface"), borderColor: c("border-strong"), textColor: c("fg") },
        hover: { backgroundColor: c("surface-muted"), borderColor: c("border-strong"), textColor: c("fg") },
        active: { backgroundColor: c("surface-strong"), borderColor: c("border-strong"), textColor: c("fg") },
      })),
    },
  };
}
