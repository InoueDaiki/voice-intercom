import { useEffect, useState, type ComponentType } from "react";

import { cx, Field, Select } from "@voice-intercom/ui-web";

import {
  AlertSection,
  AppHeaderSection,
  BadgeSection,
  ButtonSection,
  CardSection,
  CheckboxSection,
  ChoiceGroupSection,
  ConfirmDialogSection,
  FieldSection,
  FullScreenMessageSection,
  LoadErrorAlertSection,
  PageHeaderSection,
  PttButtonSection,
  SignalLampSection,
  TableSection,
} from "./sections/Components.tsx";
import { ColorsSection, ContrastSection, RadiusSection, TypeSection } from "./sections/Foundations.tsx";

// 部品を ui-web に足したら、ここと sections/Components.tsx に足す
const groups: { title: string; items: { id: string; label: string; Section: ComponentType }[] }[] = [
  {
    title: "トークン",
    items: [
      { id: "colors", label: "色", Section: ColorsSection },
      { id: "contrast", label: "コントラスト", Section: ContrastSection },
      { id: "radius", label: "角丸", Section: RadiusSection },
      { id: "type", label: "文字", Section: TypeSection },
    ],
  },
  {
    title: "部品",
    items: [
      { id: "button", label: "Button", Section: ButtonSection },
      { id: "field", label: "Field", Section: FieldSection },
      { id: "choice-group", label: "ChoiceGroup", Section: ChoiceGroupSection },
      { id: "checkbox", label: "Checkbox", Section: CheckboxSection },
      { id: "badge", label: "Badge", Section: BadgeSection },
      { id: "alert", label: "Alert", Section: AlertSection },
      { id: "load-error-alert", label: "LoadErrorAlert", Section: LoadErrorAlertSection },
      { id: "card", label: "Card", Section: CardSection },
      { id: "confirm-dialog", label: "ConfirmDialog", Section: ConfirmDialogSection },
      { id: "table", label: "Table", Section: TableSection },
      { id: "app-header", label: "AppHeader", Section: AppHeaderSection },
      { id: "page-header", label: "PageHeader", Section: PageHeaderSection },
      { id: "full-screen-message", label: "FullScreenMessage", Section: FullScreenMessageSection },
      { id: "ptt-button", label: "PttButton", Section: PttButtonSection },
      { id: "signal-lamp", label: "SignalLamp", Section: SignalLampSection },
    ],
  },
];

type Theme = "system" | "light" | "dark";

const THEME_KEY = "ui-web-catalog:theme";

function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    return "system";
  }
}

// 明暗を <html data-theme> で選ぶ(index.css の @custom-variant dark)。system なら OS の設定に従う
function useTheme() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") {
      delete root.dataset.theme;
    } else {
      root.dataset.theme = theme;
    }
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // 保存できなくても、開いている間は効く
    }
  }, [theme]);
  return [theme, setTheme] as const;
}

const themeLabels: Record<Theme, string> = {
  system: "OS の設定に従う",
  light: "明",
  dark: "暗",
};

// 画面に見えている節(ナビで今の場所を示す)
function useActiveSection(ids: string[]) {
  const [active, setActive] = useState(ids[0]);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) {
          setActive(visible[0].target.id);
        }
      },
      // 画面の上の方に来た節を今の節にする
      { rootMargin: "0px 0px -70% 0px" },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) {
        observer.observe(el);
      }
    }
    return () => observer.disconnect();
  }, [ids]);
  return active;
}

const sectionIds = groups.flatMap((g) => g.items.map((item) => item.id));

export function App() {
  const [theme, setTheme] = useTheme();
  const active = useActiveSection(sectionIds);

  // #button などで開いたとき、ブラウザは描く前にアンカーを探して見つけられないので、描いた後に移る
  useEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (id) {
      document.getElementById(id)?.scrollIntoView();
    }
  }, []);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]">
      <aside className="border-b border-border bg-surface lg:sticky lg:top-0 lg:h-dvh lg:overflow-y-auto lg:border-r lg:border-b-0">
        <div className="grid gap-3 p-4">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="size-2.5 rounded-full bg-primary" />
            <p className="font-bold">ui-web カタログ</p>
          </div>
          <p className="text-xs leading-relaxed text-fg-muted">
            packages/ui-web の部品と design-tokens の見本。決まりは ui-web の README を読む。
          </p>
          <Field label="明暗">
            <Select value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
              {(Object.keys(themeLabels) as Theme[]).map((value) => (
                <option key={value} value={value}>
                  {themeLabels[value]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <nav aria-label="目次" className="grid gap-4 px-2 pb-4">
          {groups.map((group) => (
            <div key={group.title} className="grid gap-1">
              <p className="px-2 text-xs font-medium text-fg-muted">{group.title}</p>
              <ul className="flex flex-wrap gap-1 lg:grid">
                {group.items.map((item) => (
                  <li key={item.id}>
                    <a
                      href={`#${item.id}`}
                      aria-current={active === item.id ? "location" : undefined}
                      className={cx(
                        "block rounded-md px-2 py-1.5 text-sm no-underline",
                        active === item.id ? "bg-primary-soft font-medium text-primary-fg" : "hover:bg-surface-muted",
                      )}
                    >
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
      <main className="mx-auto grid w-full max-w-5xl gap-16 px-4 py-8 sm:px-8">
        {groups.map((group) => (
          <div key={group.title} className="grid gap-16">
            {group.items.map(({ id, Section }) => (
              <Section key={id} />
            ))}
          </div>
        ))}
      </main>
    </div>
  );
}
